# Client catalog and Telegram navigation RC — 2026-10-05

## Release identity and authority

- Product source: `cab25eef3d7abd8591c2a49c3605a14acdc76585`.
- Canonical repository: `https://github.com/Dimkox/ii-tonya-platform.git`.
- RC remote branch readback: `rc/client-consent-factory` at that source SHA.
- Target: the existing separate `ii-tonya.ru` host, `157.22.187.237`,
  `/opt/ii-tonya-platform`; this is not the controller's app-stack.
- Owner explicitly requested production publication in this conversation.
- Previous native/web source: `426ee3b571de9b77aaae2e9294cb79e7cd0a596c`.
- Native and web deployment completed at approximately 03:09 UTC; independent
  host readback showed both at the product source, all three services active,
  and readiness checks passing.

This is a deployed release candidate, not completion of the full consent factory
or a claim that the complete commercial product is ready. Public catalog data
currently contains zero published eligible services. Personal dialogue, payments,
AI/provider dispatch and erasure activation remain disabled. No user or provider
facts were invented or seeded to make the product appear populated.

## Source and artifact integrity

Both bundles identify the same committed source archive:
`96bcb1864d3fe17face7403fb9a6e97ec0393cd00238b418375ca9dd9454e183`.
The web bundle was freshly built from an isolated git archive with offline,
frozen-lockfile installation, not copied from an old dist directory. Native
build and offline production deployment packaging completed successfully.
Database migrations are byte-for-byte unchanged from the previous release.

Both checksum manifests were signed with the configured release key and verified
with its public key using Cosign. Every listed artifact checksum passed.
Manifest digests:

- Native: `316f4779a8afe1e5b4c49cd8f2914b069e49f2a97b65c25eecdd01d89b2036ff`.
- Web: `96fe2e6eeefbc468becef44b36b7c5fcf0aaec27c8a25276eec8cd46bc6ad813`.

Bundles, SBOM, signatures, exact operational helpers, diagnostic output and
desktop/mobile screenshots remain in the ignored local release directory
`.native-release/client-web-cab25eef3d7abd8591c2a49c3605a14acdc76585/`.
No secret runtime file or secret webhook backup was copied into this report.

## Verification and limits

- Three independent navigation review layers, followed by bounded patch review,
  closed seven accepted findings. The manifest-pin follow-up was independently
  checked before registration; no scope guard was removed or weakened.
- First push was refused for the stale root manifest hash; focused reproduction
  had 122 passing assertions and one failure. After the reviewed single-entry
  update, all 123 assertions passed.
- Exact RC pre-push gate passed syntax, formatting, whitespace, local evidence
  integrity, changed-file lint and repository tests. No bypass or force-push.
- Focused navigation tests, relevant typechecks and native Nginx tests passed.
  PostgreSQL navigation replay passed 4/4 on the controller's final permitted run.
- The one broad Vitest run was interrupted with exit 130 after a 5-second timeout
  in an expert-referral-schema attribution test. Its cause is not established.
  It is not a full-suite PASS; raw output is archived. Do not repeat the exhausted
  navigation or catalog-worker PG files (3/3 each) under this logical task.
- GitHub check-runs for the product source were empty. Hosted CI is absent by
  repository policy, and factory Trust CI has no verified ii-tonya enrollment.
  Local gate evidence and release signatures are not Trust CI attestations.

Latest factory PR #245 was rechecked as merged, head
`a9c4eab64bf9e177b50e3a0a609626acc042a222`, merge
`326908bf6367b05b65b83818ee84a093c1e45872`. Its bounded local-read/test M8 policy
does not authorize or establish consumer Trust CI, production or provider gates.
The integration gap remains tracked in factory issue #243 and its follow-up.

## Live site readback

The controller's direct external HTTPS request read the exact product SOURCE_SHA.
A real headless Chrome session subsequently passed the full catalog/account
check with system proxies explicitly disabled, TLS verification enabled, and
no SSH tunnel or certificate bypass:

| Check                                          | Observed result                                               |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `/catalog`, `/account`, `/consent`, `/my-data` | HTTP 200; expected UI                                         |
| Readiness                                      | HTTP 200; PostgreSQL, migrations, worker lease, adapters true |
| Public catalog                                 | HTTP 200; empty, honestly displayed; public projection only   |
| Browser session configuration                  | Available; anonymous; correct bot; widget off                 |
| Anonymous private consents                     | HTTP 401                                                      |
| Forged Mini App proof                          | HTTP 401                                                      |
| Oversized session proof                        | HTTP 413                                                      |
| JavaScript failures / third-party requests     | 0 / 0                                                         |
| Browser storage                                | No localStorage or sessionStorage entries                     |
| Mobile catalog                                 | 390-pixel viewport; no horizontal overflow                    |

The first browser check used pinned SSH SOCKS and passed. A later browser run
using inherited system proxy settings timed out; a no-proxy browser and direct
curl both succeeded. The final browser evidence above is the direct run, not an
inference from the tunnel. The temporary SOCKS connection was stopped.

## Telegram configuration and unresolved delivery evidence

The token identity was checked with `getMe`: `@ii_tonya_assistant_bot`, numeric
bot ID `8658936989`; the expert promotion bot was not substituted.

The production host could not call Telegram's API directly. The first attempt
failed before creating its configuration backup or mutating Telegram. Read-only
reconciliation confirmed that boundary. Configuration then succeeded through a
temporary, pinned-SSH/controller-HTTPS relay while the original reviewed remote
program retained its host lock, credential reads, protected backup, ordering and
readback checks. Only this bot's five explicit configuration methods could be
relayed; HTTP redirects were rejected. A loopback 307 test confirmed no body was
forwarded to an unchecked destination. No permanent proxy/service was installed.

Confirmed via Telegram readback:

- Webhook targets the production client route on `https://ii-tonya.ru`.
- Exact update kinds: `message`, `edited_message`, `channel_post`,
  `edited_channel_post`, `callback_query`; max connections 2; pending updates were
  not dropped and the observed queue was 0.
- Private-chat commands: `/start`, `/help`, `/catalog`, `/privacy`, `/account`.
- Existing Mini App menu points to `https://ii-tonya.ru/account`.

Telegram reports `Connection timed out` at **2026-10-05T03:20:01Z**. The queue
remained 0 on subsequent readback. This is a fresh delivery-path warning, not
proof of successful command delivery. The public site is reachable directly and
the host firewall permits 80/443, but Telegram reachability has not been proved.
The owner was asked to launch `/start` and the Mini App from a real Telegram
account. No real-user command receipt, reply delivery or login was observed by
the controller at the time of this report. Do not treat webhook registration or
synthetic tests as that evidence.

## Recovery and cleanup

Runtime/native/web switching and recovery used a shared host flock. Recovery checks pinned
previous/candidate identities and backup hashes, fences delayed writers, waits
for terminal service jobs and checks each service independently. Temporary Nginx
syntax-check unit and both release staging directories were confirmed absent
after successful deployment. The old release and protected configuration
backups remain for recovery; no live rollback was exercised or claimed.

Any subsequent release must use its own exact previous-SHA anchor. Do not blindly
run the archived helpers against a different deployment, purge terminal bot
receipts, or enable legacy/personal ingress as a rollback technique.
