# S2b private verification jobs — read-only preparation

Status: planning evidence, not implementation or activation. S2a remains active.
Read-only scout inspected delivered source at ed47fec2 and primary documentation;
no tests, installs, provider calls, credentials or runtime changes. Reconcile exact
S2a submission/check-generation seams after its independent acceptance. Do not
start competing writes to the S2a implementer's files.

## Existing foundation

Current references are private Telegram file IDs, not object custody or usable URLs.
The applicant route accepts PDF/JPEG/PNG up to20MiB; S2a extends bounded purpose-specific
DOCX/video references. No getFile/S3/presigner/social reader exists yet. Existing
PyMuPDF1.26.7/python-docx1.2.0/lxml6.1.3 helper extracts text only, not scans/OCR.
It is optional, single-child, abortable:5MiB,5s default/10s ceiling,64KB UTF-8 output,
40-page PDF, bounded ZIP/XML. Production Node-only256MiB worker cannot establish
isolation for its384MiB helper. Resource limits alone do not isolate filesystem/network.

Reuse source patterns: integrations/documents/safe-document-parser.ts; parser/helper.py
and test_helper.py; application/expert-card-service.ts document intake; DB card repo
completion binding; worker/expert-card-materials.ts lifecycle; consent subject lock;
privacy explicit-erasure and0057 consent-trigger cleanup. S2a creates versioned
submission/request/check-generation provenance to consume rather than duplicate.

## Concrete transports to implement later

Telegram: native fetch POST getFile, then bounded streaming download under fixed
https://api.telegram.org/file/bot<TOKEN>/. Original receiving bot only. Validate
returned file ID/size and relative path: no absolute/dot/percent/query/fragment/
backslash/control path. Redirect:error, header/body deadlines, actual byte accounting,
truncation denial, fixed sanitized errors. Never persist/log the token-bearing URL.
20MiB custody and5MiB parsing are distinct. One active file operation initially;
measure memory before claiming suitability for the256MiB Node runtime.
Source: https://core.telegram.org/bots/api#file

S3: use narrowly pinned modular @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner,
not handwritten SigV4 or a broad cloud framework. Make any dependency graph changes
explicit/reviewed and reinstall only the resulting frozen graph. Explicit credentials,
region and approved endpoint; no default discovery chain, applicant endpoints, SDK
logger or hidden retries (maxAttempts1). PostgreSQL owns retry/reconciliation.
Preallocate opaque immutable key and attempt before external upload. Metadata contains
custody ID/checksum/schema only, no subject or original filename. Conditional Put
IfNoneMatch*, exact length/safe MIME/SHA256, private bucket/no public ACL, safe attachment
disposition/no-store.412 requires matching Head proof;409/timeout is unknown, not success.
Head403 is not absence. Use checksum mode where capability supports it; do not claim
support from a mock send() result. Initially require explicitly verified dedicated
non-versioned bucket; versioned deletion needs exact version tracking and removal.
Sources:

- https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html
- https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html

## Custody, erasure and links

Distinguish reference-only/unavailable/started/unknown/stored-verified and deletion
pending/unknown/verified. Parser failure does not undo actual stored custody.
Erase must revoke reads immediately and retain minimal non-cascading deletion work
for every allocated key. Unknown PUT may complete after DELETE/HEAD: one deletion or
404 cannot prove no future late object. Preserve reconciliation responsibility;
late completion can queue deletion, never recreate applicant rows. No cross-subject
deduplication or raw bytes in PostgreSQL/logs/ordinary temporary files.

Authenticated manager link generation rechecks fresh role/MFA, current application,
owner/consent and verified custody. Short presign TTL (suggested120s), exact key,
attachment/no-store; audit issuance without URL. Presigned URL remains bearer access
until expiry; session revocation alone cannot revoke an issued URL. Avoid claiming
otherwise; object deletion/revocation and explicit custody state remain required.
Source: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html

## Optional local extraction/OCR

Use actual text extraction to propose only known still-empty form fields; explicit
owner confirmation is required. No raw file text is instruction/approval/price
authority. Unsupported structuring remains manual, not fake extracted success.

Pinned PyMuPDF exposes get_textpage_ocr with fixed rus+eng tessdata. Pin model artifacts
and hashes; no runtime download or paid LLM. Add explicit page/pixel/resolution,
process/output/time budgets. Partial/failed OCR is unknown, not full match. Outcomes
separate match/mismatch/no-document/unknown and preserve bounded university/specialty/
year observations. They are suggestions to a human, not verified qualifications.

Prove a separately isolated helper image: nonroot, read-only filesystem, no network,
dropped capabilities and separate memory/PID/CPU limits. No Docker socket in the
production Node worker. Local sandbox evidence does not activate a production runtime.
Sources:

- https://raw.githubusercontent.com/pymupdf/PyMuPDF/1.26.7/docs/installation.rst
- https://raw.githubusercontent.com/pymupdf/PyMuPDF/1.26.7/docs/page.rst
- https://docs.docker.com/engine/containers/run/

## Social observations and unknown states

VK: native fixed-origin api.vk.com wall.get, explicit API version and validated
identifier; user/service token capability, not an existing community messaging token.
Bound response/time and at most two pages to avoid pinned-post distortion; retain
at most five newest posts' timestamps/media/comment observations, not bodies.
Source: https://raw.githubusercontent.com/VKCOM/vk-api-schema/master/wall/methods.json

Telegram Bot API does not supply arbitrary post history. messages.getHistory is
MTProto and explicitly user-only; never invent a Bot API method or use a pinned
message as the last post. Separately authorized user-session capability is distinct.
A t.me/s public-preview adapter is only partial/unofficial; requires genuine sanitized
fixtures before claiming parsing. Missing/partial history cannot establish inactivity;
missing comments stay null. No login/captcha workaround, scripts or arbitrary fetching.
Unsupported Instagram/site links remain manual. No unknown→BAD/inactive conversion.
Sources: https://core.telegram.org/method/messages.getHistory and
https://core.telegram.org/widgets/post

Cache per subject/canonical profile/adapter version24h, with observation/expiry times,
coverage and unavailable reason. Inactive strictly>30days only with adequate evidence.
No owner scoring thresholds for GOOD/MODERATE/BAD exist; retain explicit observations
and a content/policy slot instead of inventing a trust score. UI reads never fetch.

## Required future acceptance

Real local HTTP fixtures exercise serialized Telegram/VK transports, original bot,
path/redirect/byte/time/abort/truncation attacks and secret-canary redaction. Actual SDK
serialization/signing against a local S3 fixture or pinned emulator proves conditional
Put/checksum/recovery/403/presign/Delete behavior. PostgreSQL proves duplicate claim,
stale generation, withdrawal/erase/identity races, late unknown upload, cache expiry,
manager revocation and no resurrection. Sandbox probes must exercise outbound network,
host-file access, writes, process/memory/CPU limits plus synthetic Russian scans.

Real activation inputs remain bucket/provider/region/versioning/encryption/retention
policy and protected credentials; original bot capability; VK user/service token;
optional isolated OCR runtime/model assets; Telegram preview evidence or authorized
MTProto capability. These gate activation, not implementation/local transport proof.
Do not ask for secrets in chat or enable anything through development access.

## Dependency preparation during S2a (read-only)

On2026-10-26 the public package metadata reported3.1157.0 for both
`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, each requiring Node>=20.
These are candidate exact pins for the following implementation, not installed
dependencies or evidence of adapter compatibility. Registry integrity values:

- client-s3: `sha512-fbZIxqZVzK/PMLj9az3+ieAcYdZhzpTrfIVAnrE4PnRc1C6SokMDnaxAJycKTNmzLlY1fvmlItZWBDPUEFlGLQ==`
- s3-request-presigner: `sha512-zHdXg1UuA4Z2ICQeGCBfSL5A+0TbFCkS6uq4WoX74jpv3PozoPsaDswu2OBU6cIUJLg6JWUZd226SLM/MGHAKA==`

The client graph includes credential-provider-node transitively; explicit client
credentials still prevent accidental default-chain lookup. Include a negative test
with ambient credentials/metadata endpoints rather than claiming that the package
has no credential-discovery dependency. Actual signing, timeout, retry and redirect
behavior must be established in local transport tests after intentional lock update.
The official constructor reference documents explicit credentials and bounded Node
HTTP-handler options:
https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-client-constructors.html

Official fast OCR model repository: https://github.com/tesseract-ocr/tessdata_fast
(Apache2.0 integer LSTM models). Pin an exact revision and content hashes for rus/eng
when assembling the optional runtime; this read-only check did not download/install
models or prove recognition quality. No source, lockfile, environment or live state
changed during preparation.
