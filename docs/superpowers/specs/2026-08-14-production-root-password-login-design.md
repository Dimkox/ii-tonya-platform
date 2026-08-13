# Production root password login design

## Decision

Production provisioning for `157.22.187.237` must preserve interactive SSH password login for `root`. The password itself remains operator-held and must not be written to the repository, project `.env`, logs, release artifacts, handoff documents, or Basic Memory.

## Requirements

- `SSH-POL-001`: the local ignored project `.env` records `PROD_ROOT_PASSWORD_LOGIN_ENABLED=true`.
- `SSH-POL-002`: the local ignored project `.env` records `PROD_ROOT_PASSWORD_SOURCE=interactive` and contains no root password value.
- `SSH-POL-003`: native provisioning and deployment automation must not set `PermitRootLogin no`, `PermitRootLogin prohibit-password`, or `PasswordAuthentication no`.
- `SSH-POL-004`: release documentation states that the operator enters the root password only at the SSH prompt.
- `SSH-POL-005`: the normal application service continues to run as the unprivileged `ii_tonya` account; preserving root SSH access does not make the application run as root.

## Verification

1. Confirm `.env` is ignored and exposes only the two policy keys above.
2. Search versioned deployment assets for SSH directives that disable root/password login.
3. Confirm deployment defaults still target the unprivileged `ii_tonya` runtime user.
4. Run `git diff --check` and a credential-pattern scan over the change.

## Operational boundary

This change records and preserves the approved access policy. It does not transmit, rotate, recover, validate, or persist the production root password.
