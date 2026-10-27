# Semantic tag boundary registration

Runtime790d308c957ca9be8ab83a18ff8f3de6642921b9 is independently accepted. The
canonical full gate at5bc816f7 found missing exact registrations: two protected
admin routes, five local helper artifacts and stale barrel/journal hashes.
The failed613-test run (610 pass/3 fail) is retained as diagnostic evidence.

- `/v1/admin/expert-cards/:applicationId/tags/review` uses existing current manager
  role/session/MFA and exact draft revision. It has no financial authority.
- `/v1/admin/expert-cards/catalogue-export` requires current catalog_admin authority
  and returns bounded public taxonomy only.
- `compose.semantic-tags.yaml` and `runtime/semantic-tags/Dockerfile`, `engine.py`,
  `server.py`, `test_engine.py` are the reviewed isolated local helper. Each exact
  path and normalized-content SHA256 is pinned; no namespace/prefix exemption.
- The integrations barrel adds only the reviewed isolated-semantic-tags export.
- The journal adds only contiguous0069; historical entries and strict equality
  checks remain. Both existing duplicate journal hash registrations are advanced
  consistently without changing map/classifier behavior.

This registration enables no provider, runtime, deployment or feature flag. The
scanner, mutation detection, financial authority checks and denial behavior are
unchanged. Root owns this narrow final-gate correction and independent review.
