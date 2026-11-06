import { spawn } from "node:child_process";
import { basename } from "node:path";

const VISUAL_TOOLS = new Set(["see", "capture", "image", "analyze", "inspect_ui"]);

/** Wake only for local Peekaboo visual observation, never for discovery or unrelated MCPs. */
export function needsPeekabooDisplayWake(
  server: { transport: string; command: string | null },
  tool: string,
): boolean {
  return (
    process.platform === "darwin" &&
    server.transport === "stdio" &&
    !!server.command &&
    basename(server.command) === "peekaboo" &&
    VISUAL_TOOLS.has(tool)
  );
}

export async function wakePeekabooDisplay(
  server: { transport: string; command: string | null },
  tool: string,
  wake: () => Promise<void> = async () => {
    const wakeProcess = spawn("/usr/bin/caffeinate", ["-u", "-t", "15"], {
      detached: true,
      stdio: "ignore",
    });
    wakeProcess.unref();
    await new Promise((resolve) => setTimeout(resolve, 2000));
  },
): Promise<void> {
  if (!needsPeekabooDisplayWake(server, tool)) return;
  await wake();
}
