import type { SandboxProvider } from "@rakazo/adapter-kit";
import { BoxSandboxEmulator } from "./box-emulator.js";
import { BoxSandboxProvider } from "./box-sandbox.js";
import { CreateOSSandboxProvider } from "./createos-sandbox.js";
import { DaytonaSandboxEmulator } from "./daytona-emulator.js";
import { DaytonaSandboxProvider } from "./daytona-sandbox.js";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { ManagedSandboxEmulator } from "./e2b-emulator.js";
import { E2BSandboxProvider } from "./e2b-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { NoneSandboxProvider } from "./none-sandbox.js";
import { RailwaySandboxProvider } from "./railway-sandbox.js";
import { SshSandboxProvider } from "./ssh-sandbox.js";

export interface SandboxProviderOptions {
  supervisorUrl?: string;
  supervisorToken?: string;
  e2bApiKey?: string;
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  daytonaTarget?: string;
  createosApiKey?: string;
  createosBaseUrl?: string;
  createosShape?: string;
  createosRootfs?: string;
  railwayApiToken?: string;
  railwayEnvironmentId?: string;
  railwayMaxWorkspaceFileBytes?: string;
  boxApiKey?: string;
  boxApiUrl?: string;
  dataDir?: string;
  sshHost?: string;
  sshUser?: string;
  sshIdentityFile?: string;
  sshPort?: string;
  sshRemoteRoot?: string;
  sshAllowedBotId?: string;
}

function missingRemoteKey(
  provider: "e2b" | "daytona" | "createos" | "box" | "railway",
  envName: string,
): SandboxProvider {
  return new NoneSandboxProvider(
    `Computers unavailable: ${envName} is required for SANDBOX_PROVIDER=${provider}.`,
  );
}

export function createSandboxProvider(kind: string, opts: SandboxProviderOptions): SandboxProvider {
  switch (kind) {
    case "none":
    case "":
      return new NoneSandboxProvider();
    case "e2b":
      if (!opts.e2bApiKey?.trim()) return missingRemoteKey("e2b", "E2B_API_KEY");
      return new E2BSandboxProvider(opts.e2bApiKey);
    case "daytona":
      if (!opts.daytonaApiKey?.trim()) return missingRemoteKey("daytona", "DAYTONA_API_KEY");
      return new DaytonaSandboxProvider({
        apiKey: opts.daytonaApiKey,
        apiUrl: opts.daytonaApiUrl,
        target: opts.daytonaTarget,
      });
    case "createos":
      if (!opts.createosApiKey?.trim())
        return missingRemoteKey("createos", "CREATEOS_SANDBOX_API_KEY");
      return new CreateOSSandboxProvider({
        apiKey: opts.createosApiKey,
        baseUrl: opts.createosBaseUrl,
        shape: opts.createosShape,
        rootfs: opts.createosRootfs,
      });
    case "box":
      if (!opts.boxApiKey?.trim()) return missingRemoteKey("box", "BOX_API_KEY");
      return new BoxSandboxProvider({ apiKey: opts.boxApiKey, apiUrl: opts.boxApiUrl });
    case "railway":
      if (!opts.railwayApiToken?.trim()) return missingRemoteKey("railway", "RAILWAY_API_TOKEN");
      if (!opts.railwayEnvironmentId?.trim())
        return missingRemoteKey("railway", "RAILWAY_ENVIRONMENT_ID");
      return new RailwaySandboxProvider({
        token: opts.railwayApiToken,
        environmentId: opts.railwayEnvironmentId,
        maxWorkspaceFileBytes: opts.railwayMaxWorkspaceFileBytes,
      });
    case "ssh":
      if (!opts.sshHost?.trim() || !opts.sshUser?.trim() || !opts.sshIdentityFile?.trim())
        return new NoneSandboxProvider(
          "Computers unavailable: SSH_SANDBOX_HOST, SSH_SANDBOX_USER, and SSH_SANDBOX_IDENTITY_FILE are required.",
        );
      return new SshSandboxProvider({
        host: opts.sshHost,
        user: opts.sshUser,
        identityFile: opts.sshIdentityFile,
        port: opts.sshPort ? Number(opts.sshPort) : undefined,
        remoteRoot: opts.sshRemoteRoot,
        allowedBotId: opts.sshAllowedBotId,
      });
    case "docker":
      return new DockerSandboxProvider(
        opts.supervisorUrl ?? "http://127.0.0.1:7091",
        opts.supervisorToken,
      );
    case "e2b-emulator":
      return new ManagedSandboxEmulator();
    case "daytona-emulator":
      return new DaytonaSandboxEmulator();
    case "box-emulator":
      return new BoxSandboxEmulator();
    case "desktop":
      return new DesktopSandboxProvider({
        root: opts.dataDir,
      });
    case "fake":
      return new FakeSandboxProvider();
    default:
      throw new Error(
        `Unknown SANDBOX_PROVIDER "${kind}". Use none | docker | e2b | daytona | createos | box | railway | ssh | e2b-emulator | daytona-emulator | box-emulator | desktop | fake.`,
      );
  }
}
