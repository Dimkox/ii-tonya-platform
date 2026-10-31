# Owner decision: gateway acknowledgment boundary

The owner explicitly approved the proposed cancellation rule on 30 October 2026 (Europe/Moscow): “Да, использовать подтверждение шлюза”.

The proposed and accepted rule is: after the authenticated shared gateway acknowledges contact revocation, no new send for that receipt contact may start. A send already executing concurrently may finish. The UI may report deletion completed only after both gateway acknowledgment and the database privacy mutation complete. If cancellation is uncertain, the privacy mutation still proceeds, and the result must remain pending/uncertain rather than falsely report completed cancellation.

This supersedes the earlier requirement that an incoming deletion request must beat a network send that has not physically started even while the deletion request waits for processing. It does not change consent checks, pricing authority, initial-send admission, idempotency, proof verification, retention, access isolation or release requirements.

Implementation must use the receipt contact generation as the cancellation subject. Revoking an expired contact must not permanently disable future independently authorized contacts for the same user. Sender and revocation paths must share the same gateway state and key configuration; a local boolean or unauthenticated acknowledgment is insufficient.

Release evidence must cover concurrent in-progress send and revoke acknowledgment ordering, suppression of new sends after acknowledgment, durable restart/replay behavior, contact replacement, uncertainty, and the actual API/worker/database composition.
