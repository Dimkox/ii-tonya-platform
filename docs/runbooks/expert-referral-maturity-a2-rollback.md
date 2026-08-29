# Expert referral maturity A2 rollback

Disable new referral reward grants through the audited feature switch, then stop and
drain the maturity worker. Preserve all pending, granted, cancelled, settlement, grant,
ledger, allocation, refund, and debt facts; never delete or rewrite them.

Verify that no new maturity transitions occur and that the existing append-only
reversal/debt path remains available for already granted rewards. Forward recovery needs
a newly approved feature-control version and fresh exact-SHA verification. This runbook
does not authorize provider activation or production writes.
