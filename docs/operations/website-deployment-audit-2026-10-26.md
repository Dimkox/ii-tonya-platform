# Website deployment audit — 2026-10-26

Read-only owner-requested P0.5 audit. No release switch, deployment, configuration
change, service restart, secret read or provider activation was performed.

## Answers

| Question                                | Verified result                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where is the website code?              | `apps/web` in `Dimkox/ii-tonya-platform`, Vite/TypeScript; not a separate frontend repository. Production nginx serves `/opt/ii-tonya-platform/web-current`.                                                                                                                                                                                                                                                        |
| Current main commit?                    | `9385b9b8657b92a47e39a03c63f74e592827c7f2`, 2026-10-26T14:26:49+03:00, `chore: update Getzilla to 2.3.1 (#107)`. Confirmed with live Git ref and GitHub connector.                                                                                                                                                                                                                                                  |
| Latest frontend source change on main?  | `15972185e57d1e7f285c2d7c699467dcc2fe0bb5`, 2026-10-14T20:14:58+03:00. Frontend differs from deployed source, including newer prerendered SEO landing changes.                                                                                                                                                                                                                                                      |
| Does current main build?                | Yes. Clean detached exact-main audit worktree, Node24.22.1/pnpm11.9.0, frozen committed lockfile. `pnpm --filter @ii-tonya/web build` and `typecheck` both exit0; Vite7.3.6 builds13modules in269ms. No source changes.                                                                                                                                                                                             |
| Is automatic GitHub deployment running? | No hosted workflows are configured in this main tree; connector returns no PR-triggered workflow runs for its exact SHA (that connector endpoint is PR-filtered). Direct commit check-runs and classic status endpoints also return empty lists. Standing repository policy intentionally omits GitHub Actions. Local pre-push checks do not deploy. This does not prove that no external deployment system exists. |
| What is actually live?                  | Both `web-current` and backend `current` point to `d00d24593493cb348a25abf0eec0318a1c018ddf`; web `SOURCE_SHA` and provenance agree. Commit date2026-10-13T14:58:18Z. Symlink filesystem timestamps indicate13October. Public HTTPS request returned200; nginx active/running.                                                                                                                                      |
| Why does the old version remain?        | Verified immediate cause: production still selects the13October artifact while main contains newer frontend source. A failed build is not demonstrated: exact-main local build passes. The actor/process that omitted or failed a later publication is not established by available logs.                                                                                                                           |
| Last deployment-attempt log?            | No matching deployment log found in inspected `/opt/ii-tonya-platform` top levels or `incoming`, and journal queries for `ii-tonya-deploy.service` / `ii-tonya-web-deploy.service` returned no entries. A last failed attempt cannot be reconstructed or fabricated from this evidence.                                                                                                                             |

## Important evidence distinctions

The root `WEB_RELEASE_SHA` file still says
`39141da6fb0603eca5e75d36b05159b6d153dfd9` with an August timestamp. It disagrees
with the actual symlink, web `SOURCE_SHA` and provenance; it is a stale marker,
not deployment authority. Likewise the older September handoff is historical,
not today's runtime version.

The public homepage returned HTTP200 and SHA256
`9b1d0632c0b4ac384667dc1a636aa5f661322ebe57a10dfa35de3a8c5b9a9926`,
identical to the actual production `web-current/index.html`. Thus the observed
old page is the selected artifact, not an inferred browser-cache issue.

The public homepage was reachable by the local HTTPS probe; the web browsing
connector itself could not open it. This is not evidence of a public outage.
The HTTP client's network address is proxy-local and was not treated as the
production origin IP. SSH used the existing strictly pinned ED25519 host identity;
no private key or environment value was printed.

## Reproduction and retained local evidence

Exact-main audit worktree and untracked logs live under the canonical repository's
`.getzilla/runtime/scratch/website-audit-20261026` and adjacent
`website-audit-*.log` files. Environment preflight passes. First offline frozen
install failed because an ESLint tarball was absent locally; normal
`pnpm install --frozen-lockfile` then passed without graph changes. This is an
installation-cache limitation, not a website build failure. Build/type logs retain
actual output; generated `dist`, dependencies and downloaded public HTML remain
outside tracked product artifacts.

A corrective publication would require a separately prepared/reviewed release and
explicit deployment authorization. The present owner request is an audit; it did
not switch production to this development branch or main.
