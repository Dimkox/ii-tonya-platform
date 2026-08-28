# Commercial Core V2 A1 rollback

1. Through the audited admin workflow, set V2 admission to `false` and observe the
   control version, audit event, assignment rate, and rejected new assignments.
2. Existing `free_client_v2` assignments remain free; do not route them through the
   legacy package gate. Verify inbound completion and ledger/package counters.
3. Retire or disable tariff creation through the audited workflow. Retire an active
   tariff by setting its effective end; never update an order or historical snapshot.
4. Observe PostgreSQL audit/control state, tariff activity, assignment outcomes, and
   zero provider-operation calls. Stop on any mutation outside these append-only facts.
5. Forward recovery is to restore the approved control version and publish a new
   effective-dated tariff version after review; do not reopen or rewrite historical rows.

Rollback is reversible and bounded. It does not seed production tariffs, activate a
provider, or assert a live release gate. A2 expert-referral maturity remains disabled.
