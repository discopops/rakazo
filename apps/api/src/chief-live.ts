import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

const MAX_SDP_BYTES = 64 * 1024;
const MAX_SESSION_MS = 15 * 60 * 1000;
const LIVE_URL = "https://api.openai.com/v1/live/sessions";
const SESSION_INSTRUCTIONS = `You are the voice for Chief, an email assistant. Be concise and natural. Delegate every request about the inbox, email, drafts, or actions to Chief. Chief owns all email workflows. Never claim an email was sent unless Chief confirms it. Never ask for or accept a vague approval; approval must identify one specific final draft. You cannot send email or access mail directly.`;

type LiveSessionResponse = {
  session?: { id?: string };
  transport?: { type?: string; sdp?: string };
};
type ActiveLiveSession = { sessionId: string; timer: ReturnType<typeof setTimeout> };
const activeLiveSessions = new Map<string, ActiveLiveSession>();
const reservedLiveOwners = new Set<string>();

export function mountChiefLiveRoutes(
  app: Hono,
  deps: { prisma: PrismaClient; enabled: boolean; apiKey?: string; fetcher?: typeof fetch },
  authenticate: (request: Request) => Promise<Actor | null>,
) {
  app.post("/api/chief-live/session", async (c) => {
    const actor = await authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!deps.enabled) return c.json({ error: "Chief Live is disabled" }, 404);
    if (!deps.apiKey) return c.json({ error: "Chief Live is not configured" }, 503);
    const owner = `${actor.spaceId}:${actor.userId}`;
    const existing = activeLiveSessions.get(owner);
    if (existing || reservedLiveOwners.has(owner)) {
      return c.json({ error: "A Chief Live session is already active" }, 429);
    }
    reservedLiveOwners.add(owner);
    try {
      const botId = c.req.query("botId")?.trim();
      if (!botId || botId.length > 128) return c.json({ error: "Chief bot is required" }, 400);
      const bot = await deps.prisma.bot.findFirst({
        where: { id: botId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
        select: { id: true, name: true },
      });
      if (bot?.name.trim().toLocaleLowerCase() !== "chief") {
        return c.json({ error: "Chief bot not found" }, 404);
      }
      const sdp = await readBoundedBody(c.req.raw, MAX_SDP_BYTES);
      if (sdp === null) return c.json({ error: "SDP offer is too large" }, 413);
      if (!sdp.trim()) {
        return c.json({ error: "A valid SDP offer is required" }, 400);
      }

    const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await (deps.fetcher ?? fetch)(LIVE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${deps.apiKey}`,
            "Content-Type": "application/json",
            "OpenAI-Safety-Identifier": createHash("sha256").update(actor.userId).digest("hex"),
          },
          body: JSON.stringify({
            session: {
              model: "gpt-live-1",
              instructions: SESSION_INSTRUCTIONS,
              delegation: { type: "client" },
              input: [
                {
                  type: "message",
                  role: "developer",
                  content: [
                    {
                      type: "input_text",
                      text: "Greet the user now as Chief, ask how you can help with email, then listen.",
                    },
                  ],
                },
              ],
              audio: { output: { voice: "quartz" } },
            },
            transport: { type: "webrtc", sdp },
          }),
          signal: controller.signal,
        });
        if (!response.ok) return c.json({ error: "Live session creation failed" }, 502);
        const result = (await response.json()) as LiveSessionResponse;
        if (
          typeof result.session?.id !== "string" ||
          result.transport?.type !== "webrtc" ||
          typeof result.transport.sdp !== "string"
        ) {
          if (result.session?.id)
            await closeLiveSession(deps.fetcher ?? fetch, deps.apiKey, result.session.id);
          return c.json({ error: "Live returned an invalid session answer" }, 502);
        }
        const timer = setTimeout(() => {
          void closeLiveSession(deps.fetcher ?? fetch, deps.apiKey!, result.session!.id!).finally(
            () => {
              activeLiveSessions.delete(owner);
            },
          );
        }, MAX_SESSION_MS);
        timer.unref?.();
        activeLiveSessions.set(owner, { sessionId: result.session.id, timer });
        return c.json({ sessionId: result.session.id, sdp: result.transport.sdp }, 201, {
          "cache-control": "no-store",
        });
      } catch {
        return c.json({ error: "Live session creation failed" }, 502);
      } finally {
        clearTimeout(timeout);
      }
    } finally {
      reservedLiveOwners.delete(owner);
    }
  });

  app.post("/api/chief-live/session/end", async (c) => {
    const actor = await authenticate(c.req.raw);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!deps.enabled || !deps.apiKey) return c.json({ ok: true });
    const owner = `${actor.spaceId}:${actor.userId}`;
    const active = activeLiveSessions.get(owner);
    if (!active) return c.json({ ok: true });
    clearTimeout(active.timer);
    activeLiveSessions.delete(owner);
    await closeLiveSession(deps.fetcher ?? fetch, deps.apiKey, active.sessionId);
    return c.json({ ok: true });
  });
}

async function closeLiveSession(fetcher: typeof fetch, apiKey: string, sessionId: string) {
  await fetcher(`${LIVE_URL}/${encodeURIComponent(sessionId)}/hangup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => undefined);
}

export function liveResultEvent(delegationId: string, content: string) {
  return {
    type: "session.commentary.append",
    event_id: randomUUID(),
    delegation_id: delegationId,
    content: content.slice(0, 1600),
  };
}
