import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountChiefLiveRoutes } from "./chief-live.js";

const actor = { userId: "user-1", spaceId: "space-1" } as never;

function createApp(options: {
  authenticated?: boolean;
  enabled?: boolean;
  apiKey?: string;
  bot?: { id: string; name: string } | null;
  fetcher?: typeof fetch;
}) {
  const findFirst = vi.fn().mockResolvedValue(options.bot ?? { id: "chief-1", name: "Chief" });
  const app = new Hono();
  mountChiefLiveRoutes(
    app,
    {
      prisma: { bot: { findFirst } } as never,
      enabled: options.enabled ?? true,
      apiKey: options.apiKey ?? "test-key",
      fetcher: options.fetcher,
    },
    async () => (options.authenticated === false ? null : actor),
  );
  return { app, findFirst };
}

describe("Chief Live session route", () => {
  it("requires an authenticated user and does not call OpenAI", async () => {
    const fetcher = vi.fn();
    const { app } = createApp({ authenticated: false, fetcher });
    const response = await app.request("/api/chief-live/session?botId=chief-1", {
      method: "POST",
      body: "v=0",
    });
    expect(response.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("limits sessions to an owned Chief and uses server-side client delegation", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { session: { id: "live_test" }, transport: { type: "webrtc", sdp: "answer" } },
          { status: 201 },
        ),
      );
    const { app, findFirst } = createApp({ fetcher });
    const response = await app.request("/api/chief-live/session?botId=chief-1", {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: "offer-sdp",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ sessionId: "live_test", sdp: "answer" });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "chief-1", spaceId: "space-1", userId: "user-1", archivedAt: null },
      select: { id: true, name: true },
    });
    const request = fetcher.mock.calls[0]?.[0] as Request;
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(String(request)).toBe("https://api.openai.com/v1/live/sessions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init.body))).toMatchObject({
      session: {
        model: "gpt-live-1",
        delegation: { type: "client" },
        audio: { output: { voice: "quartz" } },
        input: [{ type: "message", role: "developer" }],
      },
      transport: { type: "webrtc", sdp: "offer-sdp" },
    });
    const duplicate = await app.request("/api/chief-live/session?botId=chief-1", {
      method: "POST",
      body: "another-offer",
    });
    expect(duplicate.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const ended = await app.request("/api/chief-live/session/end", { method: "POST" });
    expect(ended.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(
      "https://api.openai.com/v1/live/sessions/live_test/hangup",
    );
  });

  it("rejects non-Chief bots before creating a paid session", async () => {
    const fetcher = vi.fn();
    const { app } = createApp({ bot: { id: "other", name: "Assistant" }, fetcher });
    const response = await app.request("/api/chief-live/session?botId=other", {
      method: "POST",
      body: "offer-sdp",
    });
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not reserve the user's slot when request validation fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      session: { id: "live_recovery" },
      transport: { type: "webrtc", sdp: "answer" },
    }, { status: 201 }));
    const { app } = createApp({ fetcher });
    const invalid = await app.request("/api/chief-live/session?botId=chief-1", {
      method: "POST",
      body: "",
    });
    expect(invalid.status).toBe(400);
    const valid = await app.request("/api/chief-live/session?botId=chief-1", {
      method: "POST",
      body: "v=0",
    });
    expect(valid.status).toBe(201);
    await app.request("/api/chief-live/session/end", { method: "POST" });
  });

  it("stays off unless the server feature flag is enabled", async () => {
    const fetcher = vi.fn();
    const { app } = createApp({ enabled: false, fetcher });
    const response = await app.request("/api/chief-live/session?botId=chief-1", {
      method: "POST",
      body: "offer-sdp",
    });
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
