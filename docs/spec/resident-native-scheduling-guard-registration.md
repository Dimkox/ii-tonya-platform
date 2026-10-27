# Native scheduling scope registration

The approved S4a contract is `docs/superpowers/implementation-artifacts/spec-residency-native-scheduling.md`. This change registers only migration 0070 and its exact reconstructed state, nine named native schedule/service/confirmation/logistics tables, and the changed entrypoint/barrel bytes. It preserves both existing journal hash registrations and every historical migration hash. No route was added; the strict mirrored route inventory remains unchanged.

`@js-temporal/polyfill` 0.5.1 (ISC) is the only new direct dependency, in contracts. Its locked transitive dependency is `jsbi` 4.3.2 (Apache-2.0). The authoritative lockfile retains the exact pre-existing graph and adds only 15 lines. A diagnostic lock generation that changed unrelated workspace links was discarded; its diff is retained as diagnostic evidence. Installation of the minimal reviewed graph passed with `pnpm install --frozen-lockfile`.

The existing classifiers, negative probes, file limits, route lists and financial authority rules remain strict. No wildcard exemption, safety-flag relaxation, provider activation or new payment namespace is introduced. The native confirmation branch relies on an actual source-validated immutable confirmation; an arbitrary native provider label is insufficient.

Canonical integration20261027 supersedes the active numbering above: main0070..0073
remain exact; native authority is now0074 with a database-derived state on PostgreSQL17.5.
The registry adds exact0074 SQL/state plus the original native0070 archive and its provenance.
New source admission/lifecycle composition bytes are explicitly pinned; historical evidence
remains unchanged. No broad path matcher, SQL relation allowance or route is relaxed.
