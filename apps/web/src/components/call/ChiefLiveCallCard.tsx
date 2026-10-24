import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { BotAvatar, Button } from "@rakazo/ui-web";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChiefLiveState } from "../../lib/chief-live.js";
import {
  activeChiefLive,
  endChiefLive,
  subscribeActiveChiefLive,
  toggleChiefLiveMute,
} from "../../lib/chief-live.js";

export function ChiefLiveCallCard() {
  const { i18n } = useLingui();
  const [active, setActive] = useState(activeChiefLive());
  const [state, setState] = useState<ChiefLiveState>({ status: "connecting", transcript: "" });
  useEffect(() => subscribeActiveChiefLive(() => setActive(activeChiefLive())), []);
  useEffect(() => active?.session.subscribe(setState), [active]);
  if (!active) return null;
  return (
    <div
      data-testid="chief-live-call"
      className="fixed end-4 top-4 z-50 w-[360px] rounded-2xl border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex items-center gap-2.5">
        <BotAvatar color={active.botColor} identity={active.botId} size={28} />
        <span className="flex-1 truncate text-sm font-medium">{active.botName}</span>
        <span className="text-xs text-muted-foreground">
          {state.status === "connecting"
            ? i18n._(t`Connecting`)
            : state.status === "working"
              ? i18n._(t`Working`)
              : state.status === "speaking"
                ? i18n._(t`Speaking`)
                : i18n._(t`Listening`)}
        </span>
      </div>
      {state.transcript ? (
        <p className="mt-3 max-h-20 overflow-hidden text-sm text-muted-foreground">
          {state.transcript}
        </p>
      ) : null}
      {state.error ? (
        <p role="status" className="mt-2 text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={active.sessionMuted ? i18n._(t`Unmute`) : i18n._(t`Mute`)}
          onClick={toggleChiefLiveMute}
        >
          {active.sessionMuted ? <MicOff /> : <Mic />}
        </Button>
        <Button
          variant="destructive"
          size="icon"
          aria-label={i18n._(t`Hang up`)}
          onClick={() => void endChiefLive()}
        >
          <PhoneOff />
        </Button>
      </div>
    </div>
  );
}
