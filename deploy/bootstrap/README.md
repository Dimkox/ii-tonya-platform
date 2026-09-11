# Host bootstrap for the native production runtime

Out-of-band scripts that prepare the dedicated production server before the first
`scripts/deploy-native-remote.sh` run. They are not part of the release artifact and are
not executed by systemd; they are run once by an operator.

Before this directory existed, the only copies of these files lived in an unversioned
working folder on one machine, next to the release artifacts they operate on
([#50](https://github.com/Dimkox/ii-tonya-platform/issues/50)).

## Files

| File                            | Role                                                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap-ii-tonya-deploy.cmd` | Windows launcher: opens `cmd.exe`, lifts the execution-policy restriction for the current process only, then starts the PowerShell driver.                                                        |
| `bootstrap-ii-tonya-deploy.ps1` | Operator entry point. Prompts for the root password, opens `ssh root@<host>` and `scp`, and ships the payload below to `/usr/local/sbin/ii-tonya-bootstrap-<epoch>.sh`, runs it, then removes it. |
| `bootstrap-ii-tonya-remote.sh`  | The payload that executes on the host. Also kept as a plain file so it can be reviewed and diffed without decoding.                                                                               |
| `SHA256SUMS`                    | Integrity baseline for the three files above.                                                                                                                                                     |

Run order: `.cmd` → `.ps1` → `.sh` on the host.

## What the host script changes

1. Appends the deploy public key to `~ii_tonya/.ssh/authorized_keys` (idempotent by key
   comment) and fixes ownership and modes.
2. Writes `/etc/sudoers.d/ii-tonya-bootstrap-deploy` with
   `ii_tonya ALL=(root) NOPASSWD: /usr/bin/install, /usr/bin/systemctl, /usr/bin/rm`,
   validates it with `visudo -cf` and chmods it to `0440`.
3. Sets `MIGRATION_COMPATIBILITY_APPROVED_SHA` in `/etc/ii-tonya/runtime.env`, appending the
   key if it is absent.
4. Refuses to finish unless the effective sshd configuration reports
   `permitrootlogin = yes` and `passwordauthentication = yes`.

Step 3 bypasses the repository-side migration approval, and step 4 is what keeps password
root login enabled on a public host. Both are deliberate today
([PR #15](https://github.com/Dimkox/ii-tonya-platform/pull/15),
`docs/superpowers/plans/2026-08-14-production-root-password-login.md`) and both are tracked
as removal work in
[#49](https://github.com/Dimkox/ii-tonya-platform/issues/49). Do not "fix" them silently from
a maintenance change.

## Integrity

```bash
cd deploy/bootstrap && sha256sum -c SHA256SUMS
```

The PowerShell driver carries the host script as a Base64 literal rather than referencing it
by path. That decoded payload is byte-identical to `bootstrap-ii-tonya-remote.sh`
(verified 2026-09-11). Any change to the host script must therefore be re-encoded into the
driver and `SHA256SUMS` regenerated in the same commit:

```bash
python3 - <<'PY'
import base64, pathlib, re
sh = pathlib.Path("bootstrap-ii-tonya-remote.sh")
ps = pathlib.Path("bootstrap-ii-tonya-deploy.ps1")
payload = base64.b64encode(sh.read_bytes()).decode()
text = ps.read_text()
new = re.sub(r'(?<=\$payload = ")[^"]+', payload, text, count=1)
assert new != text, "payload literal not found"
ps.write_text(new)
PY
sha256sum bootstrap-ii-tonya-remote.sh bootstrap-ii-tonya-deploy.ps1 bootstrap-ii-tonya-deploy.cmd > SHA256SUMS
```

## Why this directory is `-text` in git

The repository default is `* text=auto eol=lf` with `*.ps1 text eol=crlf`. Those conversions
rewrite bytes at checkout, so `SHA256SUMS` would pass on the machine that produced it and fail
on every fresh clone. `deploy/bootstrap/.gitattributes` sets `* -text`, which stores and
materializes these files verbatim; the checksums below are therefore stable everywhere. Do not
remove it to "match the rest of the repo".

## Secret posture

These files contain public material only: two `ssh-ed25519` public keys, the host address and
account names. No private keys, passwords, tokens or provider credentials are present
(scanned 2026-09-11 for PEM/OpenSSH private-key blocks and `password=`/`secret=`/`token=`
assignments: zero matches). The root password is typed interactively by the operator and is
never stored here; the real server key material stays in the operator's SSH agent.

The public host address does appear here and already appears in
`docs/superpowers/specs/2026-08-14-production-root-password-login-design.md`, so this adds no
new disclosure.
