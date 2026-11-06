import { spawn } from "node:child_process";
import path from "node:path";
import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
} from "@rakazo/adapter-kit";
import { boundedSandboxCommandTimeoutMs } from "@rakazo/core";
import { normalizeWorkspacePath } from "./computer-support.js";

/**
 * Headless remote command/file workspace. No Docker, GUI, or remote root privileges.
 * IMPORTANT: SSH login is an OS user boundary, not a hardened container sandbox.
 * Give it a dedicated non-sudo user and a dedicated, protected SSH key.
 */
export interface SshSandboxOptions {
  host: string;
  user: string;
  identityFile: string;
  port?: number;
  remoteRoot?: string;
  allowedBotId?: string;
}

const REMOTE_HELPER = String.raw`
import os, sys, json, base64, subprocess, tempfile, shutil, stat, signal
from pathlib import Path
p = json.load(sys.stdin)
root = Path(os.path.realpath(p["root"]))
bot = p["bot"]
if not bot or not all(c.isascii() and (c.isalnum() or c in "-_") for c in bot):
    raise ValueError("invalid workspace id")
base = root / bot
if os.path.commonpath([str(root), str(base)]) != str(root):
    raise ValueError("invalid workspace")
mode = p["mode"]
def in_workspace(rel="", existing=False):
    if not isinstance(rel, str):
        raise ValueError("invalid path")
    # Absolute paths are only accepted when they resolve inside this workspace.
    if rel.startswith("/"):
        candidate = Path(rel)
    else:
        if any(x in (".", "..") for x in rel.replace("\\", "/").split("/")):
            raise ValueError("path traversal")
        candidate = base / rel
    resolved = Path(os.path.realpath(candidate))
    if os.path.commonpath([str(base), str(resolved)]) != str(base):
        raise ValueError("outside workspace")
    if existing and not resolved.exists():
        raise FileNotFoundError(str(candidate))
    return resolved
def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
def write_one(item):
    target = in_workspace(item["path"])
    parent = in_workspace(os.path.dirname(item["path"]))
    parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not target.is_file():
        raise ValueError("target not file")
    blob = base64.b64decode(item["content"], validate=True)
    if len(blob) > 8_388_608:
        raise ValueError("file exceeds 8 MiB")
    fd, temp = tempfile.mkstemp(dir=str(parent))
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(blob)
        os.chmod(temp, 0o700 if item.get("executable") else 0o600)
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
if mode == "init":
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    fresh = not base.exists()
    base.mkdir(mode=0o700, exist_ok=True)
    emit({"fresh": fresh})
elif mode == "ping":
    emit({"ok": base.is_dir()})
elif mode == "exec":
    cwd = in_workspace(p.get("cwd") or "")
    cwd.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(p.get("env") or {})
    for key in p.get("unsetEnv") or []:
        env.pop(key, None)
    argv = p.get("argv") or ["echo", "ready"]
    timeout = max(0.01, min(float(p.get("timeoutMs", 30000)) / 1000, 120))
    proc = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, start_new_session=True)
    try:
        status = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        sys.stderr.write("command timed out\n")
        status = 124
    sys.exit(status)
elif mode == "list":
    folder = in_workspace(p.get("path") or "", existing=True)
    entries = []
    for child in sorted(folder.iterdir()):
        try:
            target = in_workspace(str(child), existing=True)
            info = target.stat()
            entries.append({"path": str(child.relative_to(base)), "kind": "dir" if target.is_dir() else "file", "size": info.st_size, "executable": bool(info.st_mode & stat.S_IXUSR)})
        except (ValueError, OSError):
            continue
    emit({"entries": entries})
elif mode == "read":
    target = in_workspace(p["path"], existing=True)
    max_bytes = min(int(p.get("maxBytes") or 8_388_608), 8_388_608)
    with target.open("rb") as stream:
        data = stream.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError("file exceeds read limit")
    emit({"content": base64.b64encode(data).decode("ascii")})
elif mode == "write":
    write_one(p["file"])
    emit({"ok": True})
elif mode == "export":
    files = []
    total = 0
    for folder, dirs, names in os.walk(base, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
        for name in names:
            item = Path(folder) / name
            if item.is_symlink() or not item.is_file(): continue
            target = in_workspace(str(item), existing=True)
            size = target.stat().st_size
            total += size
            if total > 8_388_608: raise ValueError("workspace export exceeds 8 MiB")
            files.append({"path": str(item.relative_to(base)), "content": base64.b64encode(target.read_bytes()).decode("ascii"), "executable": bool(target.stat().st_mode & stat.S_IXUSR)})
    emit({"files": files})
elif mode == "import":
    for item in p["files"]:
        write_one(item)
    emit({"ok": True})
else:
    raise ValueError("unknown operation")
`;

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export class SshSandboxProvider implements SandboxProvider {
  private readonly opts: Required<Omit<SshSandboxOptions, "allowedBotId">> & {
    allowedBotId?: string;
  };

  constructor(options: SshSandboxOptions) {
    const { host, user, identityFile } = options;
    if (!/^[a-zA-Z0-9.-]+$/.test(host) || !/^[a-z_][a-zA-Z0-9_-]*$/.test(user)) {
      throw new Error("Invalid SSH host or user");
    }
    if (!path.isAbsolute(identityFile)) throw new Error("SSH identity file must be absolute");
    const remoteRoot = options.remoteRoot ?? "/home/" + user + "/rakazo-workspaces";
    if (!remoteRoot.startsWith("/") || /[\n\r]/.test(remoteRoot)) {
      throw new Error("SSH remote root must be an absolute directory");
    }
    if (
      options.port !== undefined &&
      (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
    ) {
      throw new Error("Invalid SSH port");
    }
    this.opts = {
      host,
      user,
      identityFile,
      remoteRoot,
      port: options.port ?? 22,
      allowedBotId: options.allowedBotId,
    };
  }

  describe() {
    return {
      id: "ssh",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: false,
        pty: false,
        snapshots: false,
        takeover: false,
        persistentHome: true,
        multiScreen: false,
      },
    };
  }

  private bot(computer: { botId: string }, context?: AdapterContext): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(computer.botId)) throw new Error("Invalid workspace id");
    // Shared Team computers use a space-level home key, not the requesting bot ID.
    // Enforce the caller on every operation, not against the workspace name.
    if (this.opts.allowedBotId && context?.botId !== this.opts.allowedBotId) {
      throw new Error("SSH provider is not enabled for this bot");
    }
    return computer.botId;
  }

  private remoteArgs(): string[] {
    return [
      "-T",
      "-i",
      this.opts.identityFile,
      "-p",
      String(this.opts.port),
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=8",
      "-o",
      "LogLevel=ERROR",
      this.opts.user + "@" + this.opts.host,
      "python3 -c " + shellQuote(REMOTE_HELPER),
    ];
  }

  private start(
    mode: string,
    computer: { botId: string },
    extra: Record<string, unknown> = {},
    context?: AdapterContext,
  ) {
    const workspaceId = this.bot(computer, context);
    const process = spawn("ssh", this.remoteArgs(), {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...globalThis.process.env, SSH_ASKPASS: "/usr/bin/false" },
    });
    process.stdin.end(
      JSON.stringify({
        mode,
        root: this.opts.remoteRoot,
        bot: workspaceId,
        ...extra,
      }),
    );
    return process;
  }

  private async rpc<T>(
    mode: string,
    computer: { botId: string },
    extra: Record<string, unknown> = {},
    context?: AdapterContext,
  ): Promise<T> {
    const child = this.start(mode, computer, extra, context);
    return await new Promise<T>((resolve, reject) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      let finished = false;
      const done = (error?: Error, data?: T) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        context?.signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(data as T);
      };
      const abort = () => {
        child.kill();
        done(new Error("SSH operation cancelled"));
      };
      const timer = setTimeout(() => {
        child.kill();
        done(new Error("SSH operation timed out"));
      }, 30000);
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 13_000_000) {
          child.kill();
          done(new Error("SSH response too large"));
        } else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => done(error));
      child.on("close", (code) => {
        if (code !== 0)
          return done(
            new Error(
              "SSH operation failed: " + Buffer.concat(stderr).toString("utf8").slice(0, 1200),
            ),
          );
        try {
          done(undefined, JSON.parse(Buffer.concat(stdout).toString("utf8")) as T);
        } catch {
          done(new Error("SSH returned invalid response"));
        }
      });
      context?.signal.addEventListener("abort", abort, { once: true });
      if (context?.signal.aborted) abort();
    });
  }

  async provision(
    request: { botId: string; homePath: string },
    context: AdapterContext,
  ): Promise<ComputerRef> {
    const botId = this.bot(request, context);
    const result = await this.rpc<{ fresh: boolean }>("init", request, {}, context);
    return {
      id: "ssh-" + botId,
      botId,
      kind: "ssh",
      providerRef: this.opts.remoteRoot + "/" + botId,
      fresh: result.fresh,
    };
  }

  async isRunning(computer: ComputerRef, context: AdapterContext): Promise<boolean> {
    try {
      return (await this.rpc<{ ok: boolean }>("ping", computer, {}, context)).ok;
    } catch {
      return false;
    }
  }

  async prepare(computer: ComputerRef, context: AdapterContext): Promise<void> {
    await this.rpc("init", computer, {}, context);
  }

  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    const timeoutMs = boundedSandboxCommandTimeoutMs(request.timeoutMs);
    const cwd = request.cwd
      ? request.cwd.startsWith(this.opts.remoteRoot + "/")
        ? request.cwd
        : normalizeWorkspacePath(request.cwd)
      : "";
    const child = this.start(
      "exec",
      computer,
      { argv: request.argv, cwd, env: request.env, unsetEnv: request.unsetEnv, timeoutMs },
      context,
    );
    const pending: ProcessEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    let exitCode = 255;
    let timedOut = false;
    let aborted = false;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      pending.push({ type: "stdout", data: chunk.toString("utf8") });
      notify();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      pending.push({ type: "stderr", data: chunk.toString("utf8") });
      notify();
    });
    child.on("error", (error) => {
      pending.push({ type: "stderr", data: error.message });
      notify();
    });
    child.on("close", (code) => {
      exitCode = timedOut ? 124 : aborted ? 130 : (code ?? 255);
      ended = true;
      notify();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs + 2000);
    const abort = () => {
      aborted = true;
      child.kill();
    };
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    try {
      while (pending.length || !ended) {
        if (pending.length) yield pending.shift()!;
        else
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
      }
      yield { type: "exit", code: exitCode };
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", abort);
      if (!ended) child.kill();
    }
  }

  connectScreen(
    _computer: ComputerRef,
    _request: ScreenRequest,
    _context: AdapterContext,
  ): Promise<never> {
    return Promise.reject(new Error("SSH computer has no graphical screen"));
  }

  sendInput(
    _computer: ComputerRef,
    _input: ComputerInput,
    _lease: ControlLeaseRef,
    _context: AdapterContext,
  ): Promise<void> {
    return Promise.reject(new Error("SSH computer has no graphical input"));
  }

  observe(): Promise<never> {
    return Promise.reject(new Error("SSH computer has no graphical screen"));
  }

  act(_computer: ComputerRef, _request: ComputerActionRequest): Promise<never> {
    return Promise.reject(new Error("SSH computer has no graphical actions"));
  }

  async listFiles(
    computer: ComputerRef,
    directory: string,
    context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    const result = await this.rpc<{ entries: ComputerFileEntry[] }>(
      "list",
      computer,
      { path: directory },
      context,
    );
    return result.entries;
  }

  async readFile(
    computer: ComputerRef,
    file: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    const result = await this.rpc<{ content: string }>(
      "read",
      computer,
      {
        path: file,
        maxBytes: options?.maxBytes,
      },
      context,
    );
    return new Uint8Array(Buffer.from(result.content, "base64"));
  }

  async writeFile(
    computer: ComputerRef,
    file: PortableFile,
    context: AdapterContext,
  ): Promise<void> {
    await this.rpc(
      "write",
      computer,
      {
        file: {
          path: file.path,
          content: Buffer.from(file.content).toString("base64"),
          executable: file.executable,
        },
      },
      context,
    );
  }

  async *exportWorkspace(
    computer: ComputerRef,
    context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    const result = await this.rpc<{
      files: Array<{ path: string; content: string; executable: boolean }>;
    }>("export", computer, {}, context);
    for (const file of result.files)
      yield {
        path: file.path,
        content: new Uint8Array(Buffer.from(file.content, "base64")),
        executable: file.executable,
      };
  }

  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<void> {
    const batch = [];
    let totalBytes = 0;
    for await (const file of files) {
      totalBytes += file.content.byteLength;
      if (totalBytes > 8_388_608) throw new Error("SSH workspace import exceeds 8 MiB");
      batch.push({
        path: file.path,
        content: Buffer.from(file.content).toString("base64"),
        executable: file.executable,
      });
    }
    await this.rpc("import", computer, { files: batch }, context);
  }

  snapshot(): Promise<never> {
    return Promise.reject(new Error("SSH computer snapshots unavailable"));
  }

  async stop(): Promise<void> {
    // Do not stop the shared remote VM or remove persistent workspaces.
  }

  async destroy(): Promise<void> {
    // Leave workspace intact: deleting remote user files is an explicit admin operation.
  }
}
