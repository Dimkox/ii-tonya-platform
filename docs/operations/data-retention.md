# Data retention

Owner: Privacy owner. Reviewer: Security owner. Status: not approved for live data.

| Data class                        | Legal basis                               | Retention                                 | Deletion or anonymization                                                                                                                                          | Backup expiry                         |
| --------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Identity and consent              | documented consent or contract            | account lifetime plus approved legal hold | privacy erasure worker; consent withdrawal immediately blocks optional processing                                                                                  | 35 days after primary deletion        |
| Message metadata and ledger facts | contract and fraud prevention             | 3 years, subject to legal approval        | anonymize subject identifiers; ledger facts remain immutable                                                                                                       | 35 days                               |
| Reservation and audit facts       | contract and legitimate security interest | 5 years, subject to legal approval        | minimize payload, retain immutable fact and reviewer trace                                                                                                         | 35 days                               |
| Raw conversation content          | none approved                             | prohibited                                | `RAW_CONVERSATION_LOGGING=false`; reject attempted enablement                                                                                                      | not backed up                         |
| Test-expert trial facts           | pre-contract acquisition controls         | pending legal approval                    | raw text is never stored; erasure removes Telegram identity linkage, while bounded internal IDs, digests, reservations, outcomes, and audit facts remain immutable | 35 days after approved primary policy |
| Minor data                        | no approved policy                        | prohibited                                | `MINOR_ONBOARDING_ENABLED=false`                                                                                                                                   | not backed up                         |

Every consent withdrawal and erasure job must be idempotent, processor-tracked,
and resumable. No retention period becomes operative until legal review is
recorded in `go-live-evidence.md`.

## Backup erasure verification

Elapsed retention makes a job eligible for verification; a timer or expiry date
does not prove deletion. `processor_complete` remains unverified until a trusted
server-side `BackupErasureVerifier` verifies provider inventory or a deletion
attestation for the exact job, backup policy version, and scheduled expiry.
There is no production verifier adapter supplied by this change. Real inventory,
processor receipts, and hosting snapshot evidence remain unavailable. Absence of
an observed application backup timer/cron does not establish absence of hosting
snapshots. Erasure stays disabled by default and is not approved for live data.

Before activation, the operator must supply an actual provider inventory or
deletion-attestation source, its authenticity-verification mechanism and trusted
verifier identity, the approved versioned backup policy, and evidence that its
coverage includes the relevant backup copies and hosting snapshots. The adapter
must validate the source evidence and exact request binding before returning
`verified`. A client boolean, submitted receipt, SHA256 alone, or locally generated
signature is not verification. No API route accepts a verifier result from a client.

Activation also requires protected evidence custody: an operator-approved process
must retrieve the authentic source attestation by `receiptSha256`, verify its
digest and provenance, and retain it under access control for an approved retention
period. The application receipt contains only the reference; it is not the source
attestation or an evidence archive. Access must be limited to authorized verifier
and review roles, with controlled retrieval and disposal. Storage location,
custody owner, access policy and retention must be reviewed before activation;
this requirement does not establish that such storage or a provider exists.

Trusted server composition must explicitly set
`PostgresPrivacyRepository`'s `privacyMutationCapability.activeBackupPolicyVersion`
to the same operator-approved current version used by the worker's
`backupPolicy.version`. Missing or mismatched configuration denies terminal public
receipt certification, while nonterminal receipt replay remains available. No
default version is inferred from a stored job. Current API composition does not
supply this binding, a manifest-capture adapter or a real verifier; erasure remains
unavailable. Configuring a version alone does not authorize activation.

The shared strict version-1 contract stores only `evidenceVersion`, `jobId`,
`policyVersion`, `expiresNoLaterThan`, `verifiedAt`, `method` (either
`inventory_attestation` or `deletion_attestation`), `verifierId`, and lowercase
`receiptSha256`. Job IDs must be canonical lowercase UUIDs, matching PostgreSQL's
text representation; uppercase UUID inputs are rejected, not silently normalized.
Policy and verifier identifiers are bounded machine strings of at most 128 characters;
timestamps are canonical UTC ISO strings with millisecond precision. Store no
subject data, raw provider response, or secret in this object. The digest is an
opaque reference to the independently verified attestation.

The worker allows five seconds for verification, checks a monotonic deadline even
when an adapter delays the event loop, and supplies an `AbortSignal`.
Missing, rejected, unknown, exceptional, timed-out, late, or mismatched verification
cannot certify a job. Changing the configured policy invalidates the old proof.
PostgreSQL revalidates evidence against the stored job and its own
`clock_timestamp()`, requires exactly `object_store`, `selarti`, `planerka`, and
`make_projection` acknowledged and no unfinished booking erasure work, and writes
the status and `erasure_receipt.backupVerification` in one transaction. Other
receipt fields survive. Identical proofs replay without mutation; conflicting
proofs cannot replace the persisted evidence.

Terminal reads through the worker repository and public receipt replay revalidate
the proof against database time and full timestamp precision, together with the
processor/booking prerequisites, under parent-then-child row locks. Dead-letter
transitions take the same lock order and cannot downgrade a completed job.
These locks serialize operations only until commit. There is no database
invariant preventing arbitrary SQL or old binaries from inserting or changing
child work after certification; application replay detects invalid prerequisites
but does not repair this schema gap. A reviewed database invariant and a reviewed
policy rescheduling/supersession workflow remain prerequisites to activation.
Old-policy jobs stay fail-closed until such a workflow is approved.

Historical `backup_verified` rows without valid bound evidence fail with
`Backup verification evidence is incomplete or invalid` in both worker entry
points and public erasure receipt replay. They are not rewritten or silently
certified. This increment does not complete all erasure coverage or establish a
provider's real retention practices. Restore remains separately gated: require
approved restore evidence and reapply current revocation/erasure authority before
restored data can be served or dispatched.

Run focused checks individually, observing the repository's run limits:

```sh
pnpm exec vitest run packages/worker/src/data-retention.test.ts
pnpm exec vitest run packages/application/src/privacy-service.test.ts
pnpm exec vitest run packages/worker/src/privacy-erasure.test.ts
II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/client-backup-erasure-evidence.test.ts
II_TONYA_TEST_POSTGRES_ADMIN_URL=postgresql://ii_tonya_test@127.0.0.1:33110/postgres pnpm exec vitest run tests/integration/privacy-workflow.test.ts
```
