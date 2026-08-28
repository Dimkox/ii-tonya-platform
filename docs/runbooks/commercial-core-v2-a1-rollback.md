# Commercial Core V2 A1 rollback

Use the audited admin command only. Do not write control, tariff, order, referral,
grant, ledger, allocation, or execution-result tables directly.

1. Submit `client_commercial_policy.control_v2` for object
   `00000000-0000-0000-0000-000000000041` with:

   ```json
   {"expectedVersion":<current control version>,"admissionPolicy":"legacy_package_v1","newCommandsEnabled":false,"rewardGrantsEnabled":false}
   ```

   The execution must record the matching `expectedVersion`, produce version
   `expectedVersion + 1`, and append its immutable execution result and audit event.
   Existing `free_client_v2` assignments remain immutable and free.

2. Submit `expert_referral.feature_switch` for the same control object with:

   ```json
   {"expectedVersion":<current referral version>,"newCommandsEnabled":false,"rewardGrantsEnabled":false}
   ```

   This stops new referral/residency commands and reward grants. It does not delete
   qualifying settlements, grants, ledger entries, reservations, or allocations.

3. Retire each active V2 tariff through `expert_residency.tariff_retire`, with the
   tariff version UUID as `objectId` and this payload:

   ```json
   { "retiredAt": "<RFC3339 timestamp after active_from and before active_to>" }
   ```

   The action changes only `active_to`; it must never update order snapshots or
   historical tariff facts. Creating a replacement uses
   `expert_residency.tariff_create_v2` with a new UUID, an approved effective range,
   and the exact V2 START/BASE/PRO policy payload.

Observe after each command:

```sql
select version, admission_policy from client_commercial_policy_controls
where control_key = 'client_access';
select version, new_commands_enabled, reward_grants_enabled
from expert_referral_feature_controls where control_key = 'expert_referrals';
select id, tariff_key, active_from, active_to, commercial_policy_version, credit_cap_bps
from expert_residency_tariff_versions where commercial_policy_version = 'expert_residency_v2';
select action, object_id, expected_version, safe_result
from expert_referral_admin_execution_results order by created_at desc limit 20;
select count(*) from expert_residency_provider_operations;
```

Success means both controls show their newly incremented versions with flags false,
retired tariffs are inactive at `transaction_timestamp()`, audited execution facts are
present, existing assignments and order snapshots are unchanged, and provider-operation
count remains zero. Audit and execution history is immutable: never delete or rewrite it.

Forward recovery requires a newly approved command with the observed current
`expectedVersion`, followed by a newly audited, effective-dated tariff version. Do not
reopen retired versions or rewrite any historical order, settlement, grant, or ledger row.
A2 referral maturity and provider activation remain outside this runbook.
