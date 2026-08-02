# Task 22 deployment-readiness hardening

- Scope: target-independent release, supply-chain, database-transport, and
  container-runtime hardening.
- Requirements: `docs/spec/deployment-readiness-amendment.md` (`DR-001` through
  `DR-006`).
- Independent reviews: CI/release audit and container/security audit completed
  against `07a0a597`; the first post-change review found two Important blockers.
  SBOM provenance/release verification and the explicit local-database contract
  were remediated; independent re-review passed with no remaining Critical or
  Important findings.
- Implemented: main-only provenance, strict HIGH/CRITICAL image gates, signed
  digest-bound SPDX SBOMs, Compose capability/PID/no-new-privileges controls,
  non-root evidence containers, and TLS-required non-local PostgreSQL URLs.
- Local evidence: targeted RED/GREEN tests, scope-boundary tests, and actionlint
  pass. Hosted exact-SHA gates remain pending. Local Docker is unavailable;
  hosted exact-SHA CI is the container authority.
- Remaining external gate: deployment target/adapter, GitHub environments and
  human approvers, provider staging, rollback/restore drills, and dated GO
  evidence. No deployment or live-provider activation is authorized.
