# August booking-gate runs (all RED)

Raw logs of the `booking-final-gate` attempts on the Claw host, 2026-08-14 through
2026-08-17. They existed only as a single copy in the operator's working directory.

**Every run recorded here failed. None of these directories is evidence that a gate passed,
and none authorizes anything.** They are kept because the reason each one failed is the
reason the current gate shape looks the way it does, and because after #82 the alternative —
deleting them — would leave the failed half of that history unrecorded.

## Runs

`finished_at` is taken from the run's own `.result` where the harness wrote one; otherwise the
timestamp is when the operator copied the file out of the container (UTC). The `48c07c11`
directory names carry the host wall clock, which is MSK (UTC+3) — `20260817-020803` is the same
instant as `2026-08-16T23:08Z`.

| Run                                   | `finished_at`        | mtime (UTC) | SHA        | Commit subject                                | Exit codes                                                       |
| ------------------------------------- | -------------------- | ----------- | ---------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `a3c7042`                             | 2026-08-14T14:13:00Z | 08-14 14:13 | `a3c7042`  | fix: close booking route composition review   | `booking-final-gate: exit_code=1`                                |
| `52421de`                             | 2026-08-14T14:54:22Z | 08-14 14:54 | `52421de`  | fix: close booking Claw package harness       | `booking-final-gate: exit_code=1`                                |
| `3bfe094`                             | 2026-08-14T14:59:33Z | 08-14 15:00 | `3bfe094`  | fix: close booking Claw package harness       | `booking-final-gate: exit_code=1`                                |
| `0f1851c`                             | 2026-08-14T15:04:33Z | 08-14 15:04 | `0f1851c`  | fix: close booking Claw package harness       | `booking-final-gate: exit_code=1`                                |
| `6bb751d5`                            | —                    | 08-14 15:11 | `6bb751d5` | fix: close booking Claw package harness       | `booking-final-gate: exit_code=1`                                |
| `4dd48563`                            | —                    | 08-14 15:16 | `4dd48563` | fix: close booking Claw package harness       | `booking-final-gate: exit_code=1`                                |
| `dc7f39a2`                            | —                    | 08-16 22:40 | `dc7f39a2` | fix: verify Claw booking package closure      | `client-booking: exit_code=1`                                    |
| `dc7f39a2-r2`                         | —                    | 08-16 22:42 | `dc7f39a2` | fix: verify Claw booking package closure      | `client-booking: exit_code=1`                                    |
| `48c07c11-20260817-020803`            | —                    | 08-16 23:08 | `48c07c11` | fix: complete Claw booking dependency closure | `transport: sexec_exit_code=1002`                                |
| `48c07c11-20260817-020839-actual`     | —                    | 08-16 23:08 | `48c07c11` | fix: complete Claw booking dependency closure | `transport: sexec_exit_code=1002`                                |
| `48c07c11-20260817-020944-clone`      | —                    | 08-16 23:12 | `48c07c11` | fix: complete Claw booking dependency closure | `client-booking: exit_code=1`; `transport: sexec_exit_code=1001` |
| `48c07c11-20260817-021317-seed-retry` | —                    | 08-16 23:13 | `48c07c11` | fix: complete Claw booking dependency closure | `transport: sexec_exit_code=1001`                                |
| `48c07c11-final`                      | —                    | 08-16 23:14 | `48c07c11` | fix: complete Claw booking dependency closure | no `.result` (log only)                                          |
| `48c07c11-repo-flow`                  | —                    | 08-17 00:15 | `48c07c11` | fix: complete Claw booking dependency closure | no `.result` (log only)                                          |

## What actually broke, in the logs

Two distinct failure classes, neither of them a product defect:

1. **`pnpm install` inside the per-run worktree (Aug 14, six runs).** The first line of the
   earliest log is the whole diagnosis:
   `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'pg' imported from /workspace/mvp-client-booking-final-a3c7042/scripts/assert-client-booking-postgres.mjs`,
   then `[ERROR] Command failed with exit code 1: pnpm install`, then 12/12 failures in
   `apps/worker/src/main.test.ts` for want of dependencies. The gate was rebuilt per commit in
   a fresh `/workspace/mvp-client-booking-final-<sha>` tree and could not resolve its own
   node_modules there.
2. **The exact-SHA worktree could not be created at all (Aug 16-17, eight runs).**
   `fatal: Not a valid object name 48c07c11dc1375332980f4f019c8e1bfebec65fe^{commit}` /
   `unable to create exact-SHA worktree`, with `exit_code=2` and `test_output_lines=0` — the
   clone handed to the container did not contain the commit being gated. `sexec_exit_code=1001`
   and `1002` are the transport probe failing against a container that never got as far as
   running tests.

What replaced both failure modes is visible in the tree today: `scripts/run-claw-ci.sh`
resolves node_modules from a read-only `/seed` store instead of installing per worktree
(`client-booking` mode links `/seed/node_modules/.pnpm`), and it refuses to gate anything it
cannot prove is the requested commit — `:21` asserts `git rev-parse HEAD` equals the source SHA,
`:22` and `:28` assert a clean tree down to untracked files, and `:33` fails on any missing git
object in the store. The `48c07c11` runs above are exactly the case those three checks reject.

## Commit reachability

Checked 2026-09-11 with `git branch -a --contains`:

- `a3c7042`, `dc7f39a2`, `48c07c11` — on `codex/mvp-client-booking-001`, whose PR #29 was
  squash-merged into `main` as `141fd02`.
- `0f1851c`, `3bfe094`, `52421de`, `6bb751d5`, `4dd48563` — reachable from **no branch**. They
  survive in this object store and in the off-repo `.bundle` copies listed in
  [`../off-repo-blobs-2026-09-11.md`](../off-repo-blobs-2026-09-11.md).

So five of the eight commits these logs refer to would be unrecoverable if the bundles were
deleted, while the logs themselves would be unrecoverable if this directory were deleted.
That is the whole argument for keeping both.

## File shapes

Per run directory:

- `*.log` / `raw.log` — verbatim console output of the run, including the harness's own
  key=value preamble (`source_sha=`, `ci=`, `max_workers=`, `preexisting_testcontainers=`);
- `*.result` — the harness summary, `key=value` lines (`exit_code`, `finished_at`,
  `raw_log`, `sexec_exit_code`);
- `SHA256SUMS` — present in `dc7f39a2` and `dc7f39a2-r2` only, and **listing absolute paths on
  the host that produced them** (`/home/pall/app-stack/ii-tonya-test-workspace/results/...`).
  `sha256sum -c SHA256SUMS` inside those directories therefore verifies the operator's
  original result tree, not this copy — the digests happen to match today because the originals
  are still in place, and the check is meaningless on any other machine.

That last point is why this directory carries its own manifest with repository-relative paths:

```bash
cd docs/test-evidence/booking-final-gates && sha256sum -c local-SHA256SUMS   # 31 entries
```

`local-SHA256SUMS` covers every file in this directory except itself — the 29 run files plus
`README.md` and `.gitattributes`. The `.gitattributes` sets `* -text`: seven of these files
contain CRLF as produced by the host, and the repository default (`* text=auto eol=lf`) would
rewrite them at checkout and break both manifests.

Keeping the 14 `*.log` files here took one more step: the repository-wide `*.log` rule in
`.gitignore` matched them, so `git add` skipped the raw run output — the only part of these
directories that says _why_ a run failed — without reporting anything. The commit was then
verified by checking `HEAD` out into a fresh worktree and running the manifest there, which is
what surfaced it. `.gitignore` now carries a scoped negation (`!docs/test-evidence/**/*.log`):
committed evidence is tracked, ordinary build and test logs stay ignored everywhere else.

## Secret posture

No credentials. Scanned 2026-09-11 across all 29 files for PEM/OpenSSH private-key blocks,
`ssh-ed25519` public-key material, `scheme://user:pass@host` URLs and
`password=`/`secret=`/`token=`/`api_key=` assignments: zero matches. The only host detail
recorded is the worktree path inside the container and the operator result path quoted above.
