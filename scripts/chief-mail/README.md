# Chief — Gmail index and briefing (Oracle, no Docker)

A standalone Python 3 + SQLite workflow. Gmail is authoritative. A background poll reads new or changed messages through the owner's Composio OAuth connection. TypeSafe Jev classifies only new incoming revisions. Chief retrieves the cached queue on request.

## Status — October 18, 2026

- Oracle host reached by SSH. Indexer deployed, briefing command verified, 12 tests pass.
- Gmail 2 is the only ACTIVE personal Gmail connection; duplicate revoked.
- Composio proxy GET profile, threads and history passed on the Mac.
- Working TypeSafe key validated in the jev-ultrafast project. Chief's classifier correctly identified a synthetic email as needs_reply (99% confidence).
- Oracle credentials not installed. No real inbox baseline scan has run.
- User is away from Mac: credential transfer is deliberately postponed.
- Fifteen-minute rootless cron installer STAGED, not active. Do not claim ongoing monitoring.
- Chief's Rakazo instructions include the actual briefing, status and sent-message reconciliation commands.
- GPT Live voice integration and fully cloud-hosted Rakazo are separate work.

## Activation steps — when back at Mac

1. Securely configure /home/rakazo-agent/.config/chief-mail.env in mode 0600 with COMPOSIO_API_KEY, TYPESAFE_API_KEY, CHIEF_COMPOSIO_USER_ID, CHIEF_COMPOSIO_ACCOUNT_ID and CHIEF_GMAIL_ADDRESS. Use the personal Gmail 2 account only, never a client project.
2. Manually validate read-only Gmail profile request from Oracle and check the exact address.
3. Run python3 chief_mail.py sync --full and inspect the completed pagination, classification results, and SQLite queue.
4. Run python3 chief_mail.py sync again and confirm identical incoming revisions are not reclassified. Test new inbound and confirmed outgoing messages without unapproved sending.
5. Run ./install-cron.sh as rakazo-agent ONLY after the tests pass. This installs a nonoverlapping 15-minute unprivileged cron schedule. Verify with crontab -l, logs and fresh briefing timestamps.
6. Test Chief's voice/text flow from cached briefing, plus the explicit per-email Gmail send approval.
7. Disable on repeated authentication errors or stale sync; never claim a failed or partial check succeeded.

## CLI

- python3 chief_mail.py briefing : cached queue and last successful scan timestamp
- python3 chief_mail.py sync --full : initial full reconciliation
- python3 chief_mail.py sync : history-based incremental, daily catchup
- python3 chief_mail.py mark-status --thread-id ID --expected-inbound ID --status handled
- python3 chief_mail.py mark-status --thread-id ID --expected-inbound ID --status deferred --due 2026-10-21T09:00:00+10:00
- python3 chief_mail.py confirm-sent --thread-id ID --message-id ID : verify Gmail sent message and mark answered
- python3 -m unittest -v test_chief_mail.py

## Behaviour and constraints

- No GPT/Luna calls on the timer. Jev only classifies new inbound revisions. Outgoing replies don't re-trigger Jev. New incoming replies reopen threads.
- Daily full reconciliation catches missed changes; unresolved emails never silently expire. Classification failures remain uncertain and retry.
- Chief may save drafts without approval. Sending requires separate explicit approval for the final specific email, followed by confirmed sent Gmail message ID.
- Database briefing is only a cached snapshot; last_successful_scan=null means it has not yet run.
- SQLite directory is 0700 and database 0600. Selected incoming text goes to TypeSafe Jev when classification is enabled.
- The SSH workspace is a separate non-sudo Unix user, not a hardened sandbox. Keep credentials private.
