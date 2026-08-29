# Mistakes

Focused verification omitted `legal-view.test.ts`, leaving a stale policy-heading assertion; the full web suite caught it.

The deployment review checked only the currently served HTML/JavaScript and inferred that there was no analytics requirement. The root cause was failing to inspect Git history, where the approved Yandex Metrika counter already existed and had later been removed by a wholesale `index.html` rewrite.

The prior `human_handoff` charge was hardcoded to `1`, and cross-layer fixtures preserved that assumption. The root cause was deriving the contract from outcome kind instead of the committed ledger delta, so free and legacy paths could not share a truthful 0|1 result contract.

The A1 SDD workspace was treated as wholly disposable even though it contained a tracked task report. The root cause was trusting an earlier “gitignored workspace” assumption without checking `git ls-files` for the exact directory before moving it; the directory was restored immediately.

The first A2.1 aggregate verification was invoked as `corepack pnpm verify`, but nested package scripts call `pnpm` directly and the host had no pnpm shim in `PATH`. The root cause was assuming Corepack propagation into child scripts; verification must install a temporary Corepack shim directory and prepend it to `PATH`.
