# Claw production signing key — 2026-09-17

Owner request: «создай ключ». New self-managed cosign keypair for native
bundle signatures. The previous encrypted `release-cosign.key` (used for
`7498ce65`) is retained and was not overwritten; its password is still unknown
on this host.

| Item | Value |
|---|---|
| Created | 2026-09-17 |
| Tool | cosign v3.0.6 (`/home/pall/.cosign/cosign`) |
| Algorithm | ECDSA P-256 (sigstore) |
| Public key file | `release-cosign-claw-2026-09-17.pub` (this directory, and gitignored `.native-release/`) |
| Public key SHA-256 | `b70df94582df259d977cba97867e22cc7214a2326e917812b6fd6b403ccf48d6` |
| Private key | gitignored `.native-release/release-cosign-claw-2026-09-17.key` mode 0600 |
| Password | empty (`COSIGN_PASSWORD=`) so BatchMode `sign-blob` works |
| Probe | `sign-blob` / `verify-blob` round-trip on a throwaway payload: Verified OK |

Private key material is not in Git, not on the production host, and not printed
here. `deploy-native-remote.sh` verifies with `--key "$SIGNING_PUBLIC_KEY_FILE"`
and `--bundle` against `native-release.sha256`.

This does not deploy a release. The Claw `release` gate for `origin/main`
`cb07bd1821d8106b0b0088b17bcf305662a1b792` was still running when the key was
created; the new key is what will sign that bundle.
