# Safety handoff

Owner: Clinical safety owner. Escalation owner: On-call operations lead. Status: clinically unapproved.

The deterministic safety classifier runs before intent, billing, provider calls, and model output. The locale directory source, contact verification date, supported locales, and clinically approved decision tree must be recorded before live use. Current directory source: unavailable. Verification date: not executed.

Proposed human acknowledgement SLA: 5 minutes; proposed takeover SLA: 15 minutes. On classifier, directory, provider, or network outage, fail closed, preserve a minimal redacted handoff fact, show the approved emergency fallback, and page the escalation owner. Do not route through Planerka or an intent model.

Executable checks: `pnpm exec vitest run packages/domain/src/safety.test.ts packages/worker/src/safety-handoff.test.ts`. A live gate additionally requires clinical reviewer, locale coverage evidence, an outage drill, timestamped acknowledgement/takeover receipts, and an evidence URI.
