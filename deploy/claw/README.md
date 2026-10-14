# Host drivers for the direct Claw test run

The Claw test image is built from `Dockerfile.test`. Inside the running container the gates
are started by the two scripts in this directory. They are kept next to the image they run
against because they are the only part of the test ladder that needs the host network.

| File                       | What it runs                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claw-final-policy.sh`     | Proxy-side `pnpm install --frozen-lockfile`, then the four policy/semantics tests repeated 3x (`pnpm test:repeat`)                                  |
| `claw-final-three-pass.sh` | The whole ladder: frozen install, `build`, `format:check`, `verify:deploy`, `lint`, `typecheck`, full `vitest` run three times, `pnpm audit --prod` |

## Why these exist separately from `scripts/run-claw-ci.sh`

`scripts/run-claw-ci.sh` is the offline, evidence-sealing runner: four gate modes
(`ci`, `database`, `release`, `client-booking`), `pnpm install --offline`, `repeat_limit: 1`,
and it writes a committed bundle under `docs/test-evidence/claw/<source_sha>/`.

These two drivers cover the two things that runner does not do:

- **repetition** - `run-claw-ci.sh` records a single pass; both drivers here repeat the suite
  3x, which is how a flake is separated from a real failure on a shared host;
- **network** - install and `pnpm audit` need egress, which the container only has through
  the `proxy-gateway` SOCKS proxy. Both scripts resolve that gateway with `getent` at runtime
  and write a throwaway `proxychains4` config; nothing about the proxy is stored in the repo.

`claw-final-three-pass.sh` also records per-step logs, which the sealing runner does not
commit - it keeps only the step statuses in `summary.tsv`.

## Evidence layout

`claw-final-three-pass.sh` writes to `/workspace/results/<source_sha>-three-pass/`:

- `<step>.log` - full stdout/stderr of one step;
- `summary.tsv` - `name<TAB>exit<TAB>started<TAB>finished` per step;
- `environment.txt` - node/pnpm/docker versions, cgroup limits, `df -B1 /workspace`, and the
  final `exit_code` appended at the end;
- `SHA256SUMS` - over all of the above, so a result directory can be re-checked later.

The result directory lives outside the source tree on purpose: it is a machine's working
output, not a claim about a commit. Only `run-claw-ci.sh` bundles are committed.

## Integrity

Both scripts are pinned by normalized content hash in
`tests/repo/support/payment-scope-boundary-core.ts` (`approvedAutomationArtifactHashes`), so
any edit has to re-register the hash in the same change or `scope-boundary.test.ts` fails.

This directory deliberately has no `SHA256SUMS` of its own and no `* -text` override, unlike
`deploy/bootstrap/`. The bootstrap files are shipped out of band to the production host and
include a `.ps1` whose checkout line endings differ from what is stored, so byte-exact
materialization is the only way their checksums stay meaningful. These two scripts never
travel except into the container from a checkout, and they are pure LF, so the repository
default (`* text=auto eol=lf`) already reproduces them exactly and the test-enforced pin is
the stronger of the two mechanisms.

## Secret posture

No credentials. Both scripts read no `.env`, and the only host detail they contain is the
service name `proxy-gateway`, resolved at runtime. Scanned 2026-09-11 for PEM/OpenSSH
private-key blocks and `password=`/`secret=`/`token=` assignments: zero matches.

## Why the `claw-final-` prefix

Inherited from the host copies these were written in. The names are kept unchanged so an
operator can map a recorded run back to the exact file that produced it.
