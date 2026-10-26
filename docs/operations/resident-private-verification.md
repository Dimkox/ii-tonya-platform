# Private verification jobs

The capability is disabled by default. Intake remains available independently. The worker copies accepted references using the original Telegram bot, writes an immutable opaque key into a dedicated private non-versioned bucket, and records advisory document/social observations. It never approves an applicant, calculates quality, or changes financial state. A manager can read evidence only with fresh MFA; opening a verified document creates a 120-second attachment URL on demand. The issued bearer remains usable until expiry. Logout removes links from the interface.

## Deployment prerequisites

Set `RESIDENT_PRIVATE_JOBS_ENABLED=true` only after separate deployment review. Configure `PRIVATE_BUCKET`, `PRIVATE_REGION`, `PRIVATE_ENDPOINT`, explicit `PRIVATE_ACCESS_KEY_ID`/`PRIVATE_SECRET_ACCESS_KEY`, and `PRIVATE_BUCKET_NON_VERSIONED_VERIFIED=true` only after checking that the dedicated bucket is private and versioning is disabled. Grant only required object operations in that bucket. Ambient credentials are not used. The ordinary worker must also have its original Telegram bot configuration. Optional VK needs `PRIVATE_VK_TOKEN` and `PRIVATE_VK_TOKEN_KIND=user|service`; incomplete/unavailable observations remain unknown. `PRIVATE_TELEGRAM_PREVIEW_ENABLED` is optional, unofficial, partial evidence and never proves inactivity.

The Node worker never invokes Docker or reads its socket. OCR needs the separately deployed helper in `compose.private-parser.yaml`, with its socket directory owned by UID1000 and mode0700. Mount that directory read-only into the worker and set `PRIVATE_PARSER_SOCKET` to its socket. The helper permits only peer UID1000, runs without network/capabilities, uses a read-only root, 384MiB memory including swap, 16 PIDs, one CPU and an 8MiB temporary filesystem. Ensure the worker's effective UID matches. `PRIVATE_OCR_ENABLED=true` enables integrated PyMuPDF OCR; absent helper/OCR preserves stored files and manual review.

Build-time OCR models come from `tesseract-ocr/tessdata_fast` commit `87416418657359cb625c412a48b6e1d6d41c29bd`: `rus.traineddata` SHA256 `e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225`, `eng.traineddata` SHA256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`. Supply these files to `packages/integrations/parser/build-image.sh /path/to/models`; the build verifies both hashes and hash-pinned Python wheels. Runtime downloads are prohibited. Parser input is at most5MiB, output90KB, deadline10s; PDF40 pages with at most5 OCR pages,4million pixels/page and16million total. Photo media derives JPEG from Telegram's photo kind and must still pass JPEG byte validation. Other declared types must agree with bytes.

## Recovery and privacy

Claims and immutable keys are persisted before PUT. Conditional PUT and matching HEAD checksum/metadata establish custody;409, timeouts and denied HEAD remain unknown. The worker does not repeat an unknown PUT. A manager can request HEAD reconciliation for unknown uploads, or restart bounded deletion reconciliation through “Незавершённое удаление файлов”, including when the applicant queue is empty. Document pages contain30 rows and recovery pages50; the next-page control advances by immutable UUID. No read endpoint fetches providers.

Consent withdrawal immediately removes private mappings and read grants. Minimal key responsibility survives independently. Until a privacy deletion job exists, a namespace-separated SHA256 of the internal subject UUID provides **pseudonymous erasure linkage**, not anonymity: it contains no Telegram ID, form data, filename, text or profile. Formal erasure binds this linkage to the existing deletion job before cascading mappings, including tombstones left by earlier withdrawal, and removes the digest. Verified unbound deletion also removes it. Existing privacy receipts cannot reach processor-complete/backup-verified while any related object remains pending or unknown; repository checks and SQL triggers enforce this. Normal backup proof requirements still apply.

An in-flight or unknown PUT can finish after DELETE and HEAD404. That404 never proves absence against a future write: responsibility stays unknown until write settlement and verified deletion. Three automatic deletion attempts are bounded; exhausted/unknown work requires manager reconciliation and remains visible. Do not mark it verified by manually editing SQL. A lost/ambiguous provider outcome can require operator investigation; no cleanup cron may silently discard responsibility. Erased private data is never recreated by late results.

Worker batches materialize all append-only follow-up references through the generation watermark, two update rows per cycle, preserving photo-then-text and later documents. Stale work advances instead of starving the queue. Social cache is subject/profile/adapter scoped, expires at exactly24 hours, and is refreshed only by workers. Expired results display `current:false`; provider failures remain unknown. VK inactivity requires complete latest-post coverage and strictly more than30 days; missing comments are null.

## Reproduction

Use Node24, pnpm11.9.0 and `pnpm install --frozen-lockfile`. Run the repository environment checker with `-RequireDocker`. Reuse the existing task-owned PostgreSQL17.5 cluster. Place its Compose JSON containing credentials in a mode0600 file; set `PRIVATE_EVIDENCE_COMPOSE_CONFIG` to that path and `PRIVATE_EVIDENCE_POSTGRES_PORT` to its loopback port. The committed runner passes credentials only in child memory and redacts logs. It creates/drops isolated test databases inside that cluster.

```sh
mkdir -p .superpowers/sdd/verification-private-jobs-20261026
pnpm exec vitest run packages/integrations/src/documents/private-verification.test.ts
pnpm exec vitest run packages/integrations/src/documents/private-verification-recovery.test.ts
pnpm exec vitest run packages/integrations/src/documents/verification-extraction.test.ts
node tests/acceptance/private-verification/run-postgres.mjs pg.log tests/integration/verification-private-jobs.test.ts
node tests/acceptance/private-verification/run-postgres.mjs ingress.log tests/integration/verification-private-ingress.test.ts
pnpm exec tsx tests/acceptance/private-verification/reconstruct-state.ts
```

The normal-worker integration witness requires `II_TONYA_PRIVATE_PARSER_TEST_SOCKET`; without it that one test is explicitly skipped. The final task run supplied it. Reconstruction replays every hand-authored migration, checks existing pending/submitted v1 rows, introspects into an empty temporary directory and normalizes exact SQL catalogues. It never uses `drizzle-kit generate`. Preserve compact `_sql_objects.json` formatting; its complete catalog exceeds normal formatter limits if expanded.

For the committed local parser harnesses, create `/tmp/residency-private-parser-20261026/socket` owned by UID1000 mode0700, build the image above, then start the helper using the Compose resource settings. The task used container name `ii-tonya-private-parser-20261026` and label `ii-tonya.task=verification-private-jobs-20261026`. Set `PRIVATE_PARSER_SOCKET_DIR` to that directory for Compose. Generate synthetic fixtures with `uv run --project packages/integrations/parser python tests/acceptance/private-verification/make-parser-fixtures.py` (DejaVuSans system font required). Then:

```sh
II_TONYA_OCR_TEST_MODELS=/path/to/models uv run --project packages/integrations/parser python -m pytest packages/integrations/parser/test_helper.py
node tests/acceptance/private-verification/parser-witness.mjs
node tests/acceptance/private-verification/headroom-witness.mjs
node tests/acceptance/private-verification/browser-witness.mjs
docker exec -i ii-tonya-private-parser-20261026 python -I - < tests/acceptance/private-verification/sandbox-probe.py
```

The browser harness uses actual `/usr/bin/google-chrome`, an isolated temporary profile, local API fixtures and real SDK presigning. The peer-UID probe can be run in the helper as UID0 only after temporarily allowing traversal/socket access for this synthetic fixture; restore0700/0600 immediately. This isolates peer-credential enforcement from ordinary filesystem denial:

```sh
chmod 711 /tmp/residency-private-parser-20261026/socket
chmod 666 /tmp/residency-private-parser-20261026/socket/parser.sock
docker exec -i --user 0 ii-tonya-private-parser-20261026 python -I - < tests/acceptance/private-verification/socket-denial-probe.py
chmod 700 /tmp/residency-private-parser-20261026/socket
chmod 600 /tmp/residency-private-parser-20261026/socket/parser.sock
```

Run probes only in the task-owned synthetic environment. Do not apply these temporary permission changes to a deployed helper. No task evidence authorizes live providers, staging, production or feature activation.
