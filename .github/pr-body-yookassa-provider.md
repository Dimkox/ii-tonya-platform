## Summary

- replace the former T-Bank proposal with a strict default-off YooKassa Merchant API boundary;
- persist provider operations, cap refunds, verify payment/refund facts, and deliver canonical events before terminal resolution;
- add durable webhook claims, bounded reconciliation, consent-bound encrypted receipt contacts, and exact-body unbound recovery;
- keep API/worker merchant and key-resolver composition disabled with empty activation inputs;
- use direct Claw gates only; no GitHub Actions and no production containers.

## Evidence

- Claw focused runtime: 45/45;
- PostgreSQL recovery: 5/5;
- full migration schema: 7/7;
- recursive scope: 113/113;
- package builds and targeted static checks: PASS.

Full record: `docs/test-evidence/claw/yookassa-provider-20260814/verification.md`.

## Release state

Default-off code checkpoint only. Merchant staging is BLOCKED and production deployment
is deferred. Do not add credentials or enable YooKassa/recovery in this PR.
