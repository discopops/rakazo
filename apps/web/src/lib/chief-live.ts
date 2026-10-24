import { speechFromBlocks } from "@rakazo/core";
import { rpc } from "./rpc.js";

export type ChiefLiveEvent = { type: string; [key: string]: unknown };
export type ChiefLiveState = {
  status: "connecting" | "listening" | "working" | "speaking" | "error";
  transcript: string;
  error?: string;
};

const enabled = import.meta.env.VITE_CHIEF_LIVE_ENABLED === "true";
export const chiefLiveEnabled = (botName: string) =>
  enabled && botName.trim().toLowerCase() === "chief";

export function liveEventForResult(delegationId: string, content: string, eventId: string) {
  return {
    type: "session.commentary.append",
    event_id: eventId,
    delegation_id: delegationId,
    content: content.slice(0, 1600),
  };
}

export class ChiefLiveSession {
  private readonly instanceId = crypto.randomUUID();
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private started = false;
  private ended = false;
  private delegates = new Set<string>();
  private transcriptParts: Array<{ end: number; text: string }> = [];
  private output = "";
  private listeners = new Set<(state: ChiefLiveState) => void>();
  private state: ChiefLiveState = { status: "connecting", transcript: "" };

  constructor(private readonly botId: string) {}

  subscribe(listener: (state: ChiefLiveState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(state: Partial<ChiefLiveState>) {
    this.state = { ...this.state, ...state };
    for (const listener of this.listeners) listener(this.state);
  }

  async connect() {
    if (!enabled) throw new Error("Chief Live is disabled");
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection)
      throw new Error("WebRTC voice is unavailable in this browser");
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection();
    this.connection = pc;
    pc.addTrack(this.stream.getAudioTracks()[0]!, this.stream);
    pc.ontrack = (event) => {
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = event.streams[0]!;
      void audio
        .play()
        .catch(() => this.update({ error: "Tap the page to enable audio playback." }));
    };
    const channel = pc.createDataChannel("oai-events");
    this.channel = channel;
    channel.onmessage = (event) =>
      void this.onEvent(JSON.parse(String(event.data)) as ChiefLiveEvent);
    channel.onopen = () => {
      if (this.started) this.update({ status: "listening" });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("Could not create the voice offer");
    const response = await fetch(
      `/api/chief-live/session?botId=${encodeURIComponent(this.botId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/sdp" },
        credentials: "include",
        body: sdp,
      },
    );
    if (!response.ok)
      throw new Error((await response.json().catch(() => ({}))).error ?? "Voice connection failed");
    const result = (await response.json()) as { sessionId: string; sdp: string };
    await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
  }

  async close() {
    this.ended = true;
    if (this.started && this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify({ type: "session.close", event_id: crypto.randomUUID() }));
    }
    await fetch("/api/chief-live/session/end", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    this.channel?.close();
    this.connection?.close();
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.channel = null;
    this.connection = null;
    this.stream = null;
  }

  mute(muted: boolean) {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  private async onEvent(event: ChiefLiveEvent) {
    if (event.type === "session.started") {
      this.started = true;
      this.update({ status: "listening" });
      return;
    }
    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
      const end = typeof event.end_ms === "number" ? event.end_ms : 0;
      this.transcriptParts.push({ end, text: event.delta });
      this.update({ transcript: this.transcriptParts.map((part) => part.text).join("") });
      return;
    }
    if (event.type === "session.output_transcript.delta" && typeof event.delta === "string") {
      this.output += event.delta;
      this.update({ status: "speaking" });
      return;
    }
    if (event.type !== "session.delegation.created") return;
    const delegation = event.delegation as { id?: unknown; target?: unknown } | undefined;
    if (
      delegation?.target !== "client" ||
      typeof delegation.id !== "string" ||
      this.delegates.has(delegation.id)
    )
      return;
    const delegationId = delegation.id;
    this.delegates.add(delegationId);
    const offset = typeof event.offset_ms === "number" ? event.offset_ms : Number.POSITIVE_INFINITY;
    const request = this.transcriptParts
      .filter((part) => part.end <= offset)
      .map((part) => part.text)
      .join("")
      .trim();
    if (!request) {
      this.sendResult(delegationId, "I did not get a complete request. Please say that again.");
      return;
    }
    this.update({ status: "working" });
    try {
      const sent = await rpc.threads.send({
        botId: this.botId,
        text: request,
        clientNonce: `live:${this.instanceId}:${delegationId}`,
      });
      const result = await waitForChiefRun(this.botId, sent.runId);
      this.sendResult(
        delegationId,
        result || "Chief finished the request but did not return a spoken summary.",
      );
      this.transcriptParts = this.transcriptParts.filter((part) => part.end > offset);
      this.output = "";
    } catch {
      this.sendResult(
        delegationId,
        "Chief could not complete that request. The thread has the latest status.",
      );
    }
  }

  private sendResult(delegationId: string, content: string) {
    if (!this.started || this.ended || this.channel?.readyState !== "open") return;
    this.channel.send(
      JSON.stringify(liveEventForResult(delegationId, content, crypto.randomUUID())),
    );
  }
}

type ActiveChiefLive = {
  session: ChiefLiveSession;
  botId: string;
  botName: string;
  botColor: string;
  sessionMuted: boolean;
};
let active: ActiveChiefLive | null = null;
const activeListeners = new Set<() => void>();
export function activeChiefLive() {
  return active;
}
export function subscribeActiveChiefLive(listener: () => void) {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}
function announceActive() {
  for (const listener of activeListeners) listener();
}
export async function startChiefLive(bot: {
  id: string;
  name: string;
  color?: string;
}): Promise<boolean> {
  if (!chiefLiveEnabled(bot.name)) return false;
  const session = new ChiefLiveSession(bot.id);
  try {
    await session.connect();
    active = {
      session,
      botId: bot.id,
      botName: bot.name,
      botColor: bot.color ?? "",
      sessionMuted: false,
    };
    announceActive();
    return true;
  } catch {
    await session.close();
    return false;
  }
}
export async function endChiefLive() {
  const closing = active;
  active = null;
  announceActive();
  await closing?.session.close();
}
export function toggleChiefLiveMute() {
  if (!active) return;
  const muted = !active.sessionMuted;
  active.sessionMuted = muted;
  active.session.mute(muted);
  announceActive();
}

async function waitForChiefRun(botId: string, runId: string): Promise<string> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const snapshot = await rpc.threads.get({ botId });
    const reply = snapshot.messages.find(
      (message) => message.role === "bot" && message.runId === runId,
    );
    const run =
      snapshot.activeRuns?.find((candidate) => candidate.id === runId) ??
      (snapshot.run?.id === runId ? snapshot.run : null);
    if (run && ["failed", "cancelled"].includes(run.status)) {
      return "Chief could not complete that request.";
    }
    if (reply && (!run || run.status === "completed")) {
      return speechFromBlocks(reply.blocks).trim().slice(0, 1600);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "Chief is still working. Check the thread for the latest status.";
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Voice connection timed out")), 10_000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      resolve();
    });
  });
}
