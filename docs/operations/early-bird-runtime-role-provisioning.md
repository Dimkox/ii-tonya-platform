# Explicit Early Bird runtime role provisioning

This operator command provisions function capabilities after the reviewed schema
has been installed. It does not migrate the database, create LOGINs, generate
passwords, enable payment features or authorize a provider call.

The fixed catalogue is `scripts/early-bird-role-capabilities.json`. Each entry maps
runtime configuration keys to one NOLOGIN capability and its exact permitted
function signatures. `knownBindingReader` and `compositePaymentReader` refer to
the same capability and must use the same configured isolated login. Distinct
capabilities require distinct logins.

Provision dedicated existing LOGINs using the operator's established credential
process. They must be INHERIT, nonowner, nonsuperuser, NOCREATEDB, NOCREATEROLE,
NOREPLICATION and NOBYPASSRLS, with no additional role memberships, table/column
or sequence access, schema/database CREATE privileges or unrelated privileged
function access. Never map a shared application login or migration owner. The
command rejects broad principals instead of stripping their rights and risking
other production features.

Write a protected JSON file containing capability names and existing login names,
without passwords, connection URLs or key material. Example shape only:

```json
{
  "ii_tonya_wave_sender": "dedicated_wave_sender_login",
  "ii_tonya_wave_intent_reader": "dedicated_wave_candidate_login"
}
```

Use operator-managed `PGSERVICE`/`PGPASSFILE` for an authorized role-provisioning
connection. Do not place database credentials in command arguments, this JSON,
repository files or shell output. Run:

```sh
node scripts/provision-early-bird-runtime-roles.mjs --mapping /protected/runtime-role-logins.json
```

The command creates missing NOLOGIN capabilities idempotently, checks existing
capabilities and logins, grants only schema USAGE plus listed function EXECUTE,
and grants each capability to its selected login without ADMIN OPTION. It checks
that functions are SECURITY DEFINER, inaccessible to PUBLIC and owned by a role
outside the selected principal's memberships. It grants no direct table or
sequence rights and no CREATE authority. All changes occur in one transaction;
a failed check rolls back the transaction. Runtime principals remain subject to
the repositories' independent privilege audits.

The mapping may provision a service-specific subset. Runtime composition must
still require every configured capability needed by that service. SQL execution
has a 30-second statement timeout and a 5-second lock timeout; libpq connection
timeout is ten seconds. Existing extra privileges are an error requiring explicit
operator investigation. The CLI reports a sanitized error; an authorized operator
can inspect the transaction error through the established protected database
administration process without dumping environment variables or secrets.

The existing legacy settlement login is a separate trust model with existing
financial table permissions. Do not include it in this isolated capability map.
Its narrowly scoped coverage-helper grant remains
`scripts/sql/provision-early-bird-legacy-coverage.sql` and must be reviewed alongside
the legacy settlement witness.

At preparation time the catalogue has source-derived metadata tests. A final
canonical-schema PostgreSQL witness must execute the real generated SQL, exercise
each runtime principal audit and confirm forbidden capabilities before these
grants are used on production. Metadata tests do not establish actual target
role safety or credential/process isolation.

The canonical 0081 candidate was independently exercised with all 22 original
capabilities and genuine limited logins, including idempotent provisioning and
rejection of migration-owner and unexpected table privileges. Four worker
capabilities are added for the subsequent 0082 worker boundary: `reviewSource`,
`waveRetention`, `deferredRetention` and `finalCall`. `reviewPrepare` reuses the
existing deferred account-writer capability. These worker entries require 0082;
the provisioner deliberately fails if their functions are unavailable. The
extended 26-capability catalogue was then exercised against the actual canonical
0000–0082 chain in `tests/integration/early-bird-runtime-migration-state.test.ts`:
all 26 genuine logins received exactly their own capability, repeated provisioning
was idempotent, direct table reads and schema CREATE were denied, and owner or
unexpected table grants were rejected. The same test independently compared the
actual normalized snapshot and complete SQL/ACL catalogue with the committed 0082
state. No worker table privileges are granted by this mechanism. Target production
credentials, process isolation and rollout remain separate release evidence.

The 0083 publication and launch-kit entrypoints add two more capabilities,
`publication` and `launchKit`. The full 28-role catalogue was verified against
canonical 0000–0083 in
`tests/integration/early-bird-launch-migration-state.test.ts`, including the same
idempotence and denial checks. Each catalogue entry records its introducing
migration so historical prefix witnesses retain their exact older role sets.
`docs/operations/early-bird-role-logins.example.json` is a complete, non-secret
example mapping consistent with both API and worker examples. Replace names with
the actual independently provisioned logins; never add passwords or connection
URLs to that file.
