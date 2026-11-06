# Dormant specialist fleet and approval policies

Rakazo supports a fleet of specialists that can be configured without running paid models during provisioning.

## Fleet

The initial four specialists are Research Analyst, Software Engineer, Automation Operator and Media Producer. Each was created with `skipIntro: true`, has isolated memory, a dedicated computer setting, notifications disabled, an explicit model and thinking level, and no routines. They are grouped in a dormant specialist section. No initial model introduction is queued. The owner's existing primary agent remains outside that section.

- Research Analyst: GPT-6 Luna, medium thinking. Evidence and source dates; no scheduled activity.
- Software Engineer: GPT-6 Luna, medium thinking. Scoped code reviews, implementation and tests only when requested.
- Automation Operator: GPT-6 Luna, low thinking. CI, cron, service reliability; no unsolicited changes.
- Media Producer: GPT-6 Luna, low thinking. Media planning and reusable production workflows; no automatic paid generation.

The space-wide text model default was configured as GPT-6 Luna, with GPT-5 Mini as its backup. These are model routing preferences, not evidence of a tested failover. Model inference is charged only if a model is run. No routine was scheduled.

## Backend approval changes

Rakazo's normal connector tool path now requires an owner approval card for a direct Gmail/Outlook send, reply or forward tool, regardless of the account's `always_allow` policy or automatic reviewer. The card is limited to Approve this email / Do not send; it no longer offers an always-approve choice. Composio multi-execute batches containing a send are rejected so the model must call each outgoing email tool separately. Creating, updating and saving drafts through explicitly named email draft tools remain approval-free.

This gate covers the Rakazo **connector executor**, not arbitrary HTTP requests, custom shell commands or external systems with independent Gmail permissions. A full integration test with actual authenticated approval and Gmail's sent receipt is required before relying on this as a security boundary. Voice approval is not yet linked to the same backend consent mechanism.

## Tool isolation limits

The specialist profiles disable thirteen consequential **built-in** tools, and their computer mode is dedicated rather than sharing the primary agent's computer. These built-in restrictions do not limit their Composio connector access. The currently configured SSH provider permits only the primary agent; the specialists' computer access will not work until separately provisioned. No extra MCP servers have been assigned.

**Owner-selected policy:** all specialists may use every Composio connection accessible to this Rakazo space; do not introduce per-agent connector restrictions. The existing Composio connection is shared, not memory-isolated. This is intentional. Individual outgoing emails still require explicit approval through the backend email-send gate. Agent instructions are not an authorization boundary.

## Backend change

`bots/create` accepts a new optional `skipIntro` boolean (default `false` for compatibility). Setting it true creates an idle bot without enqueueing an introductory LLM run.

## Testing and operation

Focused tests cover the no-intro schema, mandatory per-email approval even with an allow rule, refusal of nested Composio sends, the approval UI, and draft-only exceptions. Run with `pnpm exec vitest run` on the relevant contract, core and adapter test files. Type-check API, core and adapter packages. No real Gmail sends should be used as an acceptance test unless the user specifically approves an individual test email.

Nothing here starts the pending Oracle Gmail polling schedule or completes the separate GPT Live backend. Those remain separate follow-up tasks. Push reusable code only to an authorized remote; this repository is public, so do not commit account IDs, credentials or local audit scripts.
