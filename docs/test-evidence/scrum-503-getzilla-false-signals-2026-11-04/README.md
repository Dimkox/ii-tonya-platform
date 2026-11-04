# SCRUM-503 slice 4: Getzilla scanner false signals, reproduced

Fixed pair: base `ee323e396183104e694570dec5675879558f5afa` (repository root commit),
head `a37c3c7354e1b94e02943dda314151311c9d5363` (`main` on 2026-11-04). Engine: vendored
Getzilla 2.3.1 (`.getzilla/getzilla.zip`).

Reproduce (read-only; uses a temporary detached worktree that it then removes):

    node scripts/reproduce-getzilla-false-signals.mjs ee323e39 a37c3c73

Output is in `reproduction.json`. The engine reports `status: incomplete`, `risk: high`,
`gaps: [BINARY_OR_UNKNOWN_INVENTORY]`. That one gap blocks qualification by itself.

## The signals and their causes

`review_plan.assess()` marks a Git-binary path (numstat `-\t-`) as an incomplete inventory if it
ends in an `_EXECUTABLE_BINARY` suffix (`.zip`, `.gz`, ...), has no extension, has mode
`100755`, or is not a regular file. Otherwise it adds a `BINARY_FILE` high-risk reason.

| #   | Signal                                                      | Paths | Engine cause              | Why it is false                                                                                           |
| --- | ----------------------------------------------------------- | ----: | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | `BINARY_OR_UNKNOWN_INVENTORY` from gzipped test logs        |  1237 | `.gz` suffix              | Each one gunzips to UTF-8 text (slice-1 class `compressed-text-evidence`). It is evidence, not a program. |
| 2   | `BINARY_OR_UNKNOWN_INVENTORY` from gzipped screenshots      |     3 | `.gz` suffix              | Each one gunzips to a PNG (`compressed-inert-image`).                                                     |
| 3   | `BINARY_OR_UNKNOWN_INVENTORY` from `labelled.docx.gz`       |     1 | `.gz` suffix              | Reviewed fixture, pinned by blob id and listed in its manifest (`reviewed-document-fixture`).             |
| 4   | `BINARY_OR_UNKNOWN_INVENTORY` from `.getzilla/getzilla.zip` |     1 | `.zip` suffix             | This is the engine archive that runs the scan. Getzilla flags its own vendored copy.                      |
| 5   | `BINARY_FILE` high-risk reasons                             |    15 | plain binary, mode 100644 | Web images (`png/webp/avif`). Correctly non-blocking, but they force the `full` profile.                  |

No signal comes from an extensionless name, the `100755` mode, a non-regular mode, or an
unreadable numstat row. `unexplained` is empty: every path is covered by a slice-1 class.

## Environmental false signal (seen while reproducing)

`UNCOMMITTED_INVENTORY` appears when `assess()` runs in a dirty checkout. It ignores the
requested head: it reads `HEAD` and `git status` of its root. Run it from an unrelated
branch or with untracked files, and it scores the wrong tree. The script avoids this by
running in a clean detached worktree of the head commit.

## Follow-ups

- Slice 3: fix upstream in Dimkox/Getzilla. Classify `.gz` by content (gunzip and sniff), and
  exempt the engine's own archive by pinned digest.
- Slice 2: run `classify-historical-binaries.mjs --check` in CI so new binaries cannot slip in.
