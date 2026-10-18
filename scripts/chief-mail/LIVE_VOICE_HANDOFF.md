# Chief voice handoff — GPT Live + Luna + Gmail index

## Product behaviour

The text agent remains GPT-6 Luna for tool use and detailed reasoning.
The voice surface uses gpt-live-1 for natural speech, interruption and
conversation pacing. Live does not replace Chief's agent instructions
or directly mutate mail/database. Chief owns Gmail actions.

1. User taps Voice on the phone and asks what needs attention.
2. Live can greet immediately. A client delegation invokes Chief/Luna,
   which first runs the Oracle brief command:
   python3 /home/rakazo-agent/chief-mail/chief_mail.py briefing
3. Chief returns a compact summary with freshness, sender, urgency and
   thread IDs. If scan timestamp is null, disclose background checker
   isn't running and optionally use live Composio reads.
4. The user dictates reply instructions. Luna saves a Gmail draft and
   describes the final recipient, subject and message to Live.
5. User approves THAT email via authenticated voice or text.
   The backend must verify a complete approval for that particular draft.
   Only then may Chief call Composio's Gmail sending tool.
6. After Gmail returns a sent message ID, Chief calls the Oracle
   confirm-sent command. Never mark sent from a request without receipt.
7. A deferral or "handled" decision is written with mark-status and an
   expected incoming Gmail message ID to prevent overwriting new work.

## API integration to implement in Rakazo

- Use official GPT Live, not legacy TTS/transcribe transport, for this path.
- Backend-authenticated Hono route accepts WebRTC SDP offer and the
  selected Chief bot ID; OpenAI project API key stays server side.
- POST the SDP and session config to https://api.openai.com/v1/live/sessions
  with model gpt-live-1 and delegation type client. Choose voice at
  creation; do not assume it can be changed mid-session.
- Return SDP answer and session ID. Client binds remote audio and a
  data channel; wait for session.started before application messages.
- Monitor session.input_transcript.delta, maintain utterances and
  disambiguate approvals. Do not treat arbitrary partial deltas as a
  final approval for an email send.
- On session.delegation.created, use the latest confirmed user request
  and stored conversation context to call the existing Rakazo
  threads.send / followUp / answer workflow for Chief.
- Poll or subscribe to thread completion; send concise verified result
  with session.commentary.append and original delegation_id.
  Append only appropriate summaries, not secrets or giant tool dumps.
- Debounce repeated delegations for the same incoming turn, coordinate
  interruption, and cancel or finish backend tasks deliberately.
- Server must enforce user identity, bot scope, allowed mail account,
  one-email-at-a-time send approval, and bounded audio session cost.
- Prefer existing voice UI as fallback until end-to-end phone call tests
  pass. Keep this experimental mode behind a feature flag.
- The existing local Rakazo web server cannot be reached from a remote
  phone without HTTPS cloud hosting / secure reverse access. The
  Oracle mail-indexer alone does not provide the voice web server.

## Suggested acceptance tests

- Live briefing with populated cache: correct actionable count, no
  unnecessary Gmail fetches or Luna hallucinated inbox claims.
- Empty, uninitialized cache: explicit "not scanned yet" message.
- Approval denied: draft saved, ZERO Gmail send calls.
- Two drafts: approval for first must not authorize second.
- Send timeout: verify SENT before considering a retry.
- Fresh inbound after replied: Jev classifies once, item reopens.
- Barge-in while backend runs: no duplicate run or send.
- Phone 4G, Wi-Fi change, reconnect, denied microphone permission.
- Confirm costs: GPT Live is billed for active duration; Luna
  delegation/tool calls are billed separately. No Live cost on timer.

## Official references verified October 2026

https://developers.openai.com/api/docs/guides/live
https://developers.openai.com/api/docs/guides/voice-webrtc
https://developers.openai.com/api/docs/guides/live-delegation
https://developers.openai.com/api/docs/guides/live-conversations
https://developers.openai.com/api/docs/models/gpt-live-1
