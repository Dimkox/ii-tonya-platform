# Mistakes

## 2026-08-17 — Misclassified the existing Claw test container as insufficient for the requested test release

Root cause: I inferred the deployment topology from the absence of a persistent staging API/worker service instead of first inspecting the existing Compose service labels, mounts, and its role in the agreed test-release flow. This delayed the handoff after the green gate and created an unnecessary request for a separate staging path.

## 2026-08-27 — Used an unsupported Vitest serial-run flag for the gitignore guard

Root cause: I reused a Jest-style `--runInBand` option without checking the repository's Vitest CLI. The project was unaffected; the guard was rerun with Vitest's supported options.
