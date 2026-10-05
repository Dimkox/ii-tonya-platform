- source_spec: `docs/superpowers/implementation-artifacts/spec-backup-erasure-evidence.md`
  summary: Approve an explicit backup policy rescheduling and supersession workflow before erasure activation; old-policy jobs must remain fail-closed meanwhile.
  evidence: Scheduling binds a job and proof to an exact policy version and expiry. Worker/public replay reject a different active policy, and no reviewed transition for superseding that schedule or its evidence is implemented by this bounded change.

- source_spec: `docs/superpowers/implementation-artifacts/spec-backup-erasure-evidence.md`
  summary: Establish a reviewed database invariant protecting certified jobs from later child-work insertion or mutation by arbitrary SQL and old binaries before erasure activation.
  evidence: Parent and child row locks serialize only until transaction commit. Existing SQL triggers check completion updates but do not prevent later unfinished processor/booking work. Application terminal replay now revalidates these prerequisites; no schema change was authorized in this patch round.
