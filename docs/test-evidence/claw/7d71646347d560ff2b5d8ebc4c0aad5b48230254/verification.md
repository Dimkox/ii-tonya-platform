# Claw verification for `7d71646347d560ff2b5d8ebc4c0aad5b48230254`

- Branch: `codex/task25-expert-referral-implementation`
- Test host: Claw `192.168.0.229`
- Finished: `2026-08-04T05:17:30Z`
- Result: 14 of 14 gate steps passed; process exit code `0`
- GitHub Actions: not invoked
- Source archive SHA-256: `1e7abb4628d764f1d1c4a89b1d321d2da7e752d16d6e373fa71330f1bd38e4a4`
- Test image ID: `sha256:a8f8d4bb072b4ef94f5cdf36a077a3be158bc314282c37fe026ffbe468746cb8`
- Host Compose SHA-256: `ee7ef8aa1f962aa68253c813f51968127f2f7b3dfb7a1d7c5df4096f7f69c9ff`

## Runtime contract

- CPU: 1 core (`NanoCpus=1000000000`)
- Memory: 1 GiB (`Memory=1073741824`)
- Root filesystem: read-only
- Linux capabilities: all dropped
- Security option: `no-new-privileges:true`
- Container user: `1000:1000`; supplemental Docker socket group: `988`
- Node: `24.18.0`; pnpm: `11.9.0`; Docker CLI: `29.7.0`

## Cleanup verification

- Temporary PostgreSQL databases matching `ii_tonya_test_%`: `0`
- Test role: `ii_tonya_test_runner`; superuser: `false`; createdb: `true`
- Remaining `ii-tonya-test` or `ii-tonya-local-evidence` containers: `0`
- Remaining `ii-tonya-local-evidence_*` volumes: `0`
- Existing app-stack containers were observed running after the gate; containers with configured health checks reported healthy.

`remote-SHA256SUMS` is the manifest generated on Claw for every raw step log plus
the two exported result files. It passed `sha256sum -c` on the host before download.
Raw logs remain on Claw and are intentionally not committed because they can contain
runtime details. The committed files passed a secret-pattern scan.
