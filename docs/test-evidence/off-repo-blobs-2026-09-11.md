# Off-repository blobs, inventoried 2026-09-11

Binary transfer artifacts that stay outside version control (size, and a git bundle is not a
reviewable diff), recorded here so their identity survives the machines that hold them. All
paths are relative to the operator working directory `/home/pall/projects/ii-tonya-base/`;
every digest and size below was measured on 2026-09-11 on the host that holds them.

This is an inventory, not an archive: nothing here is fetchable from GitHub. If a blob is
deleted, the row becomes the only remaining proof it existed, which is exactly why the
"uniquely preserved" column exists.

## Git bundles (checkout transfer)

| Path                                                           |     Bytes | Mtime      | SHA-256                                                            |
| -------------------------------------------------------------- | --------: | ---------- | ------------------------------------------------------------------ |
| `ii-tonya-45750b4d1a8748aedae5e765f11300bc3a63d6cd.bundle`     | 2,016,752 | 2026-08-13 | `ad22077ec4c24c79397ec84ab919db303ca7d2290fec4df5b3649abcd85e6e4e` |
| `ii-tonya-67c77f2da0c7794ffd9455a986ca04fe05f0f715.bundle`     | 2,008,955 | 2026-08-13 | `bd7b0409bb148c168c66cb63f17845c81c6b6fac5c7db7e5aad3f692e47f67b6` |
| `ii-tonya-77f02d6f001e0642909dcb8abb495420b051d94d.bundle`     | 2,008,487 | 2026-08-13 | `458e93c1bb407dec43e0dc2aeaf8f36d9908f5a56a21eccb31ddf4c2aa1c4c17` |
| `ii-tonya-887c462065bc8d4f480b5474135638a5bc063b8c.bundle`     | 2,009,897 | 2026-08-13 | `734fdf2183231398261d85640228f41ebebc69d21eeae824f27895b05783aaef` |
| `artifacts/b03.bundle`                                         | 3,067,986 | 2026-08-14 | `6b6fd6295f6f8ba7965b3e7903b4d434e785bf61b0c3acdc2d253a0a3f825ea4` |
| `artifacts/b4.bundle`                                          | 3,067,545 | 2026-08-14 | `ae37cb7729d5483fe5ac37b509e5737dc6d6aede8aee33f5cd869e47177a37c7` |
| `artifacts/b9.bundle`                                          | 3,067,596 | 2026-08-14 | `63c06e829e032497646b6119aeef347cdcafd344ddbb948b4e005ce6e90c0902` |
| `artifacts/mvp-client-booking-0f1851c.bundle`                  | 3,067,338 | 2026-08-14 | `ad991f085f64617b85008615b878d60c3058307893aa08b43e9b8fb355167d20` |
| `artifacts/mvp-client-booking-3bfe094.bundle`                  | 3,067,343 | 2026-08-14 | `ebcc13f4181a81a079b49ceb9c612757a93307f0e96a6a391465b76ec9bd323f` |
| `artifacts/mvp-client-booking-52421de.bundle`                  | 3,067,203 | 2026-08-14 | `98587c4b2a889ac77468f90ddc3ce4ddacade0dcde7043bf51bd46074c7cc777` |
| `artifacts/mvp-client-booking-6bb751d5.bundle`                 | 3,068,285 | 2026-08-14 | `f75689d3f7876b20d1e95b91809c39a9604d421c206c67d573ef803073c3f69b` |
| `work/ii-tonya-platform/mvp-client-booking-001-a3c7042.bundle` | 2,563,020 | 2026-08-14 | `f0a7e1e86dd8d3fbe3c153b7720ae18f523f2b4f2fa1496a4a28d3203f292920` |
| `work/ii-tonya-platform/controller-booking-4a39bba.bundle`     | 3,068,006 | 2026-08-14 | `3ac486ad63fc5b57b6482a1f8a5b635f71ace3ceab4bef23290b9da8bd8cc96b` |

### Commits these bundles uniquely preserve

Five of the SHAs named in [`booking-final-gates/`](booking-final-gates/README.md) are reachable
from no branch in the repository today. Verified by fetching each bundle into a scratch bare
repository and running `git cat-file -e <sha>^{commit}` — not by matching file names:

| Commit     | Carried by                                     |
| ---------- | ---------------------------------------------- |
| `0f1851c`  | `artifacts/mvp-client-booking-0f1851c.bundle`  |
| `3bfe094`  | `artifacts/mvp-client-booking-3bfe094.bundle`  |
| `52421de`  | `artifacts/mvp-client-booking-52421de.bundle`  |
| `6bb751d5` | `artifacts/mvp-client-booking-6bb751d5.bundle` |
| `4dd48563` | `artifacts/b4.bundle`                          |

`artifacts/b03.bundle` and `artifacts/b9.bundle` carry none of the five. Ref counts from
`git bundle list-heads`: the seven `artifacts/*.bundle` files and
`work/ii-tonya-platform/controller-booking-4a39bba.bundle` expose 89 refs each (37 branches plus
tags — a scratch fetch of `refs/heads/*` yields 37); the four
`ii-tonya-<full-sha>.bundle` files and `mvp-client-booking-001-a3c7042.bundle` expose a single
ref each.

Reproduce a check:

```bash
git init --bare /tmp/probe && git -C /tmp/probe fetch -q \
  /home/pall/projects/ii-tonya-base/artifacts/b4.bundle 'refs/heads/*:refs/heads/*'
git -C /tmp/probe cat-file -e 4dd48563^{commit} && echo present
```

## Source snapshots

| Path                                            |     Bytes | Mtime      | SHA-256                                                            |
| ----------------------------------------------- | --------: | ---------- | ------------------------------------------------------------------ |
| `client-catalog-red.tar.gz`                     | 1,620,100 | 2026-08-14 | `b211f4ba183466fe59af7adf677dd6320a7ddb5cce51f9935d82f26cd9aa3933` |
| `client-catalog-task3.tar.gz`                   | 1,625,004 | 2026-08-14 | `4f7000a95c77d530c076baf1886a8d34f3f9cf7d6c108a58f23830850dbab96a` |
| `artifacts/yookassa-foundation-remediation.tar` |   118,784 | 2026-08-14 | `ec22d75605e17e311382a1ce2d15e283c386b4f2c56b3edff2099494bbb2b382` |
| `artifacts/yookassa-recovery-a73098a.tar`       |   204,800 | 2026-08-14 | `0b62ce6b8b75ae0ae081c98572f7a24eec1cb12eb8aed9f56331b5517228e5cc` |
| `artifacts/yookassa-recovery-format.tar`        |   168,960 | 2026-08-14 | `463ee490b2873e10ab03d2b7208428ce0538694f9e4621f7217c0a98075a7ee7` |
| `work/ii-tonya-6a75c01-20260803.tar.gz`         |   687,321 | 2026-08-03 | `178d389952e5dc65a4611c3020cc42ef579a7feac4f985555da2e4d096f5747e` |
| `work/ii-tonya-fdf2cd7-20260803.tar.gz`         |   687,292 | 2026-08-03 | `b296c0af4e46b7f85056f9003a462fae690a4321544e06748536d7ff79558c20` |
| `work/ii-tonya-956afc6-20260803.tar.gz`         |   688,018 | 2026-08-03 | `ae2e03f1d800e01446869c3b5ccc22ed1222905a70e36e1f4ec59cde8c8e9056` |
| `work/ii-tonya-04db293-20260803.tar.gz`         |   710,925 | 2026-08-03 | `20bfc340f2abed057c25d021a0afb8c8ba7e08cfd65aece554077b1c6fb15e17` |
| `work/ii-tonya-95d391a-20260803.tar.gz`         |   711,464 | 2026-08-03 | `0e89a5ce8bf1fbd6c67e4c72bf70b25953b819a80ef02d04ca00df7c6341fb66` |
| `work/ii-tonya-d926293-20260803.tar.gz`         |   711,562 | 2026-08-03 | `c2a298b52e29b987c38210d8c2e309f54955d8be60c3c63b94c04198e60cdc00` |

## Release artifacts

The `7498ce6` native release (`native-release.tar.gz` 19,607,524 B, SPDX, provenance, cosign
bundle, public key) is inventoried with its verification results in
[`releases/7498ce656e1e49fe2d92c83f02d9667eb3f86b9b/artifacts.md`](releases/7498ce656e1e49fe2d92c83f02d9667eb3f86b9b/artifacts.md)
rather than duplicated here. `.native-release/` is excluded by `.gitignore`; the encrypted
signing key inside it (`release-cosign.key`, mode 0600) is not represented in any file in this
repository and its digest is deliberately not listed above — recording it would invite a check
against material that should never reach a checkout.

## Operator scripts

The host-side helpers that used to live only in this directory are now versioned:
`claw-final-policy.sh` and `claw-final-three-pass.sh` moved to `deploy/claw/` in PR #80. The
remaining files at that level (`bootstrap-ii-tonya-*.{sh,ps1,cmd}`) were already byte-identical
to `deploy/bootstrap/`, verified by digest on 2026-09-11, so the copies in the working directory
are redundant rather than orphaned.

## Hygiene note

`work/ii-tonya-platform/mvp-client-booking-001-a3c7042.bundle` and
`work/ii-tonya-platform/controller-booking-4a39bba.bundle` sit inside the repository working
tree and are **not** covered by `.gitignore`, so they appear in `git status` on every run.
That is the intended state until their digests above are the accepted record: they are the
only copies of `a3c7042` outside the branch it landed on, and moving or deleting them is the
operator's call, not a cleanup an automation should make silently.
