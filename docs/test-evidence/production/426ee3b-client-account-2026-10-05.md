# Client account production RC 2026-10-05

The new web account and matching API were deployed to the separate ii-tonya.ru
production host at approximately 00:40 UTC (03:40 GMT+3). This records the cabinet
slice, not completion of the full client-consent factory specification.

- Runtime source SHA: `426ee3b571de9b77aaae2e9294cb79e7cd0a596c`.
- Repository: `https://github.com/Dimkox/ii-tonya-platform.git`.
- Published RC ref: `rc/client-consent-factory`; source commit verified remotely.
- Owner explicitly authorized implementation, RC push, deployment and bot choice
  by the existing token in this conversation. No new credentials were requested.
- Target: ii-tonya.ru, existing native systemd/PostgreSQL/nginx infrastructure,
  not app-stack or a replacement hosting service.
- Selected client bot: `ii_tonya_assistant_bot`, verified through `getMe`.
  The separate expert bot was not modified.

## Live result

| Check                                      | Observed result                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Native API and web version                 | Both `426ee3b571de9b77aaae2e9294cb79e7cd0a596c`                             |
| API, worker, nginx services                | All active                                                                  |
| Readiness                                  | HTTP 200; postgres, migrations, workerLease and adapters true               |
| `/account`, `/consent`, `/my-data`         | HTTP 200, matching Russian page titles and real login UI                    |
| Browser configuration                      | Available, selected client bot, legacy widget disabled, erasure unavailable |
| Anonymous private reads                    | HTTP 401                                                                    |
| Correctly shaped but forged Mini App proof | HTTP 401, no identity/session created                                       |
| Oversized 8193-byte session request        | HTTP 413 at nginx                                                           |
| Live browser                               | Chrome, TLS validation enabled, no page exceptions                          |
| Browser privacy                            | No localStorage/sessionStorage data; no implicit Telegram widget            |
| Page referrer policy                       | `no-referrer`                                                               |
| Mobile viewport                            | 390×844, account title/login visible, no horizontal overflow                |
| Telegram menu readback                     | `web_app`, «Личный кабинет», `https://ii-tonya.ru/account`                  |

The Chrome check reached the public HTTPS origin through a temporary SOCKS tunnel
on the same pinned SSH connection because direct network access from Claw was
unreliable. It did not bypass TLS validation, inject a production session, create
a synthetic production user or seed production legal documents. Real Telegram
user authentication has **not been observed**. The actual authenticated workflow
was verified in an isolated local HTTPS/HMAC/PostgreSQL fixture; that is not a
claim of live-user acceptance.

Read-only post-deploy inventory: 40 migrations; zero users, channel identities,
document versions, consent facts, presentations and client sessions. This also
confirms the negative login probes did not create production subjects.

## Verification and its limits

- Frozen dependency installation, workspace and test typechecks, changed-file
  lint, formatting and whitespace checks passed.
- Independent cabinet, edge and dependency reviews reported no remaining finding
  within their reviewed scopes after bounded remediation. Deployment helper review
  also closed backup verification and lost-SSH-acknowledgement recovery findings.
- The exact RC push passed the installed pre-push gate: shell syntax, formatting,
  whitespace, evidence integrity, outgoing-file lint and `tests/repo`.
- The exact committed source produced the web asset `index-Dpi9PAwo.js`, native
  API/worker bundles, SBOM and provenance. Offline frozen production deployment
  packaging succeeded. Both checksum manifests were signed and locally verified.
- The native release artifact passed API-ready and worker-heartbeat smoke checks
  against the task's isolated PostgreSQL 17.5 instance; its test schema was cleared.
- Production dependency audit after security updates reported no known
  vulnerabilities. Fastify is 5.12.5; reviewed fast-uri and gRPC overrides are pinned
  in the committed lockfile. Dependency-boundary test: 123/123.
- The one full Vitest run passed 307 files / 2374 tests / zero skips **before**
  the later review remediations and dependency updates. It was not rerun or
  relabeled as exact-RC evidence. Subsequent changes have focused evidence in
  [the child specification](../../superpowers/implementation-artifacts/spec-client-web-account.md).
- Final private-read binding regression: RED then GREEN 3/3. Final bulk
  account-switch regression: 7/7. Exhausted PostgreSQL files and the full suite
  were not rerun contrary to repository limits.
- Factory Trust CI remains unavailable for this repository: the live policy
  enrolls the factory repository only. **There is no factory exact-SHA CI or
  Database Gate receipt for this RC.** The local gate and signatures are not
  substitutes. Factory integration/path issue:
  [adaptive-grok-build-pro #243](https://github.com/Dimkox/adaptive-grok-build-pro/issues/243).

## Artifact digests

| Artifact                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `native-release.tar.gz`          | `f5b6081207512964a5eb7e6a06104d129cb0bade0c51438d7750bc0551fce282` |
| `native-release.spdx.json`       | `fb881bd1bf7ede5e6d9981e41efe93fe170dd41a72d905008c17b7b2ab6fbae3` |
| `native-release.provenance.json` | `140c47f237d8df31d929d28253008681a144ca9875dbf7c8cb11d1d690925bb9` |
| `web-release.tar.gz`             | `67ff4cb65d9a9dffa6faa4f2aa2c3f005e3e7a4465985b32cc7707ac760a332e` |
| `web-release.provenance.json`    | `271026265e9f1029e5b78851db04e235295ce1b067f6121ba9e3a95fff05efe4` |
| `ii-tonya.nginx.conf`            | `96e279c50ce077459dd8db935699cd384a6b18850d95361661dad04d8e6cdde0` |

Signed bundles are retained locally in
`.native-release/client-web-426ee3b571de9b77aaae2e9294cb79e7cd0a596c/` (gitignored).
No private signing key, bot token, runtime.env or database credentials are part
of this evidence or the repository.

## Activation and recovery

Only browser client sessions and privacy routes were enabled. Legacy browser
widget login remains off: it is not a workaround for the unresolved BotFather
domain ownership/configuration. The supported login entry is the selected bot's
Mini App menu. The Telegram menu was set using the documented JSON-serialized
`menu_button` form parameter and read back; an earlier JSON-body attempt returned
success without changing the observed menu, so it was not accepted as evidence.
See [Telegram's method contract](https://core.telegram.org/bots/api#setchatmenubutton).

Client Telegram message ingress, hybrid routing, Selarti response ingress,
B2 Telegram dispatch, worker outbox delivery, Selarti, payments and raw
conversation logging remain off. No production schema additions were made by
this change; migration execution confirmed the existing committed history.

Preserved rollback targets and backups on the deployment host:

- Native: `releases/88c34f3f6b53fc099c14cc750cc71225fa0bbbe3`.
- Web: `web-releases/0f49618e3e3b6d064e830f3b8ba77db794555bd0`.
- Runtime: `/etc/ii-tonya/runtime-before-426ee3b571de9b77aaae2e9294cb79e7cd0a596c.env`.
- Runtime backup digest marker:
  `/etc/ii-tonya/runtime-install-started-426ee3b571de9b77aaae2e9294cb79e7cd0a596c`.
- Nginx: `/opt/ii-tonya-platform/configuration-backups/nginx-before-426ee3b571de9b77aaae2e9294cb79e7cd0a596c.conf`,
  with its corresponding digest marker.

Recovery order: reconcile/restore the web symlink and verified nginx backup;
restore the verified old runtime environment **before** rolling back/restarting
the old native release; verify services, readiness and both release targets.
Restore the bot's previous `commands` menu if fully reverting the cabinet launch.
The deploy helpers implement this error path, but a live rollback drill of this
particular release was **not** performed. The first deployment attempt stopped
before any mutation because the legacy web tree lacked `SOURCE_SHA`; its actual
target was verified using `web-current`, and the compatibility check was corrected.

## What is not complete

- Six purpose-specific approved document bodies and publication records are
  absent, so new consent issuance remains unavailable. No boilerplate was falsely
  recorded as approved evidence.
- Erasure is explicitly unavailable; provider, storage and backup coverage is
  not proven complete.
- Special-category written consent/signature, pre-consent text quarantine,
  late-provider-response and queued-delivery fencing, recipient/meeting/snapshot
  binding for expert disclosure and public catalogue delivery remain open in the
  full factory scope. Unsafe associated capabilities remain disabled.
- Direct browser widget login and real-user Telegram acceptance remain unverified.
- Factory enrollment and exact-source CI remain open. Both parent and child
  specifications retain non-complete status.

## Cleanup

The task-owned HTTPS fixture and its synthetic database were removed; the isolated
PostgreSQL container was stopped and auto-removed; the temporary SSH SOCKS tunnel
was stopped. The task's temporary directory, including its disposable test TLS
key, was removed after copying screenshots, executed operational helpers, menu
backup and earlier diagnostic logs to the gitignored signed-release directory's
`operational-evidence/` subdirectory. No task listener remained on ports 3000,
3109, 33110, 34108 or 34444. Production rollback releases/configuration backups,
signed artifacts and the user's unrelated untracked files were preserved.
