# Receipt revocation outbox: deployment contract (draft)

`receipt_revocation_outbox.sql` is an unnumbered design draft, not an applied migration. Its final migration number and journal entry must be selected by the release coordinator along with the gateway authority migration. Do not enable checkout solely because this table exists.

Before enabling a fenced gateway, provision separate PostgreSQL principals and grant only the privileges each needs:

- Privacy transaction principal: `SELECT`, `INSERT`, and `DELETE` on `public.receipt_revocation_outbox`. It persists subject UUID, contact UUID, keyed token, and key version before attempting cancellation. It deletes a ticket after a gateway acknowledgement.
- Recovery worker principal: `SELECT` and `DELETE` on this table, with no `INSERT`. It may delete only after an authenticated `revoke_contact` acknowledgement. A failure leaves the ticket available for the next retry.
- Gateway authority principal: the minimum `SELECT` required to reject dispatch for any pending `contact_id`, plus execution of the reviewed claim and revoke functions. It must fail closed if this relation or the authority functions are unavailable. It must never treat the outbox as proof of provider payment.

The API and recovery worker must receive the same subject key and matching key version from an isolated secret provider; never log them. Initial owner testing uses a single version `v1` with no rotation. Before rotating, retain an isolated gateway and recovery capability for each old key version until its pending tickets have been acknowledged and removed. A privacy retry remains uncertain while any ticket for the subject exists, including tickets under old versions.

The UUIDs and keyed token are pseudonymous personal data, not anonymous data. No foreign key may cascade-delete unresolved tickets. They exist only until ACK, at which point the row is removed. Restrict access, monitor pending age and counts without logging tokens or UUIDs, and define the operator escalation and key-retirement procedure before release.

A database error while capturing tickets rolls back the privacy mutation; a gateway outage after durable ticket insertion commits the privacy mutation and returns an uncertain result. A success response requires an authenticated gateway ACK for each contact, or an authenticated readiness barrier if none exist. An ACK is the owner-approved cancellation boundary: already-running sends may complete; no subsequent send may start for the cancelled contact. TLS/socket authentication alone does not establish process identity or network exclusivity. Independent egress isolation, gateway restart fencing, target-specific role checks, recovery evidence, and exact-SHA CI remain separate release gates.
