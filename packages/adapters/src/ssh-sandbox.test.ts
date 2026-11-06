import { describe, expect, it } from "vitest";
import { createSandboxProvider } from "./sandbox-factory.js";
import { resolveSandboxProvider, sandboxProviderOptionsFromEnv } from "./sandbox-provider-env.js";
import { SshSandboxProvider } from "./ssh-sandbox.js";

describe("SSH sandbox configuration", () => {
  it("fails closed when credentials are missing", async () => {
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "ssh" })).toBe("none");
    expect((await createSandboxProvider("ssh", {})).describe().id).toBe("none");
  });

  it("accepts an explicit SSH provider with bounded privileges", async () => {
    const env = {
      SANDBOX_PROVIDER: "ssh",
      SSH_SANDBOX_HOST: "192.0.2.10",
      SSH_SANDBOX_USER: "agent",
      SSH_SANDBOX_IDENTITY_FILE: "/tmp/test-key",
      SSH_SANDBOX_ALLOWED_BOT_ID: "chief-test",
    };
    expect(resolveSandboxProvider(env)).toBe("ssh");
    const options = sandboxProviderOptionsFromEnv(env);
    const provider = await createSandboxProvider("ssh", options);
    expect(provider).toBeInstanceOf(SshSandboxProvider);
    expect(provider.describe()).toMatchObject({
      id: "ssh",
      capabilities: { graphical: false, persistentHome: true, takeover: false },
    });
  });

  it("authorizes the requesting bot, not a shared Team workspace id", async () => {
    const provider = new SshSandboxProvider({
      host: "192.0.2.10",
      user: "agent",
      identityFile: "/tmp/test-key",
      allowedBotId: "chief-test",
    });
    const context = {
      operationId: "test",
      traceId: "test",
      spaceId: "test",
      userId: "test",
      signal: new AbortController().signal,
      botId: "other-bot",
    };
    await expect(
      provider.provision({ botId: "team-shared", homePath: "/unused" }, context),
    ).rejects.toThrow("SSH provider is not enabled for this bot");
    await expect(
      provider.provision(
        { botId: "team-shared", homePath: "/unused" },
        { ...context, botId: undefined },
      ),
    ).rejects.toThrow("SSH provider is not enabled for this bot");
  });

  it("rejects shell metacharacters and non-absolute SSH identity paths", () => {
    expect(
      () =>
        new SshSandboxProvider({
          host: "host.example; touch /tmp/pwned",
          user: "agent",
          identityFile: "/tmp/test-key",
        }),
    ).toThrow("Invalid SSH host");
    expect(
      () =>
        new SshSandboxProvider({
          host: "192.0.2.10",
          user: "agent",
          identityFile: "relative-key",
        }),
    ).toThrow("absolute");
  });
});
