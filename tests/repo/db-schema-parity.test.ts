import { existsSync, readFileSync } from "node:fs";
import {
  getTableConfig,
  getViewConfig,
  type AnyPgTable,
  type PgView,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  adminApprovals,
  adminCaseActions,
  adminObjectAssignments,
  adminRoleAssignments,
  adminSessions,
  channelIdentities,
  clientIdentityProofReceipts,
  clientProfiles,
  clientSessions,
  experts,
  integrationInbox,
  integrationErrors,
  integrationOutbox,
  dialogues,
  dialogueDeliveries,
  dialogueInboundTombstones,
  selartiResponseProposals,
  messageEvents,
  messageLedgerEntries,
  messagePackages,
  notifications,
  outboxOperatorAlerts,
  privacyDeletionJobs,
  privacyDeletionManifests,
  privacyProcessorAttempts,
  privacyRetentionItems,
  providerSubjectMappings,
  projectionCheckpoints,
  promptVersions,
  providerCursors,
  reservations,
  slots,
} from "../../packages/db/src/schema/index.js";
import * as dbSchema from "../../packages/db/src/schema/index.js";

const names = (table: AnyPgTable) => {
  const config = getTableConfig(table);
  return {
    checks: config.checks.map(({ name }) => name).sort(),
    foreignKeys: config.foreignKeys
      .map((foreignKey) => foreignKey.getName())
      .sort(),
    indexes: config.indexes.map(({ config: index }) => index.name).sort(),
    uniques: config.uniqueConstraints.map(({ name }) => name).sort(),
  };
};

describe("authoritative Drizzle schema parity", () => {
  it("describes the operator case inbox invariants", () => {
    expect(names(outboxOperatorAlerts)).toMatchObject({
      checks: [
        "outbox_operator_alerts_case_reason_check",
        "outbox_operator_alerts_case_type_check",
        "outbox_operator_alerts_lifecycle_check",
        "outbox_operator_alerts_payload_check",
        "outbox_operator_alerts_status_check",
      ],
      indexes: ["outbox_operator_alerts_unresolved_cursor_idx"],
      uniques: ["outbox_operator_alerts_outbox_reason_unique"],
    });
  });

  it("exports every reviewed expert referral relation", () => {
    const expectedExports = [
      "expertReferralCodeBatches",
      "expertReferralCodes",
      "expertReferrals",
      "expertResidencyTariffVersions",
      "expertResidencyOrders",
      "expertResidencyPaymentAttempts",
      "expertResidencyProviderOperations",
      "expertResidencyReceiptContacts",
      "expertTelegramResidencyCallbacks",
      "expertResidencyProviderEventInbox",
      "expertFirstResidencySettlements",
      "expertReferralMaturities",
      "expertReferralRewardGrants",
      "expertReferralLedgerEntries",
      "expertReferralLedgerAllocations",
      "expertReferralIssuanceOverrides",
      "expertReferralAbuseHolds",
      "expertReferralFeatureControls",
      "expertReferralBalances",
    ];
    for (const exportName of expectedExports) {
      expect(dbSchema, exportName).toHaveProperty(exportName);
    }
  });

  it("describes expert referral database invariants in Drizzle metadata", () => {
    const requiredTable = (
      exportName: string,
    ): ReturnType<typeof names> | undefined => {
      const table = (dbSchema as Record<string, unknown>)[exportName];
      expect(table, exportName).toBeDefined();
      if (table === undefined) return undefined;
      return names(table as AnyPgTable);
    };

    expect(names(experts).uniques).toEqual(["experts_user_id_unique"]);
    expect(requiredTable("expertReferralCodeBatches")?.uniques).toContain(
      "expert_referral_batches_id_inviter_unique",
    );
    expect(requiredTable("expertReferralCodes")).toMatchObject({
      foreignKeys: expect.arrayContaining([
        "expert_referral_codes_batch_owner_fk",
      ]),
      uniques: expect.arrayContaining([
        "expert_referral_codes_id_inviter_unique",
      ]),
    });
    expect(requiredTable("expertReferrals")).toMatchObject({
      checks: ["expert_referrals_distinct_experts"],
      foreignKeys: expect.arrayContaining(["expert_referrals_code_owner_fk"]),
      uniques: [
        "expert_referrals_code_unique",
        "expert_referrals_id_invitee_unique",
        "expert_referrals_id_inviter_unique",
        "expert_referrals_invitee_unique",
      ],
    });
    expect(requiredTable("expertResidencyOrders")).toMatchObject({
      checks: [
        "expert_order_cash_credit_conservation",
        "expert_order_cash_remainder",
        "expert_order_credit_cap",
        "expert_order_currency_rub",
        "expert_order_deadline_after_creation",
        "expert_order_deadline_not_after_provider",
        "expert_order_duration_positive",
        "expert_order_group_event_limit",
        "expert_order_money_bounds",
        "expert_order_policy_version",
        "expert_order_settlement_interval",
        "expert_order_statistics_level",
        "expert_order_support_priority",
        "expert_order_v2_cap",
        "expert_order_v2_duration",
        "expert_order_v2_price",
      ],
      uniques: [
        "expert_orders_expert_idempotency_unique",
        "expert_orders_id_expert_unique",
      ],
    });
    expect(requiredTable("expertTelegramResidencyCallbacks")).toMatchObject({
      checks: [
        "expert_telegram_residency_callbacks_action_check",
        "expert_telegram_residency_callbacks_checkout_outcome_check",
        "expert_telegram_residency_callbacks_checkout_state_check",
        "expert_telegram_residency_callbacks_expiry_check",
        "expert_telegram_residency_callbacks_processing_lease_check",
        "expert_telegram_residency_callbacks_telegram_id_check",
        "expert_telegram_residency_callbacks_token_hash_check",
      ],
      foreignKeys: [
        "expert_telegram_residency_callbacks_expert_id_experts_id_fk",
        "expert_telegram_residency_callbacks_tariff_version_id_expert_residency_tariff_versions_id_fk",
      ],
      indexes: [
        "expert_telegram_residency_callbacks_expiry_idx",
        "expert_telegram_residency_callbacks_processing_lease_idx",
        "expert_telegram_residency_callbacks_url_cleanup_idx",
      ],
      uniques: ["expert_telegram_residency_callbacks_idempotency_unique"],
    });
    expect(requiredTable("expertResidencyPaymentAttempts")?.uniques).toEqual([
      "expert_payment_attempt_id_order_unique",
      "expert_payment_attempt_idempotency_unique",
      "expert_payment_attempt_provider_request_unique",
    ]);
    expect(requiredTable("expertResidencyProviderOperations")).toMatchObject({
      checks: [
        "expert_provider_operations_amount",
        "expert_provider_operations_claim_digest",
        "expert_provider_operations_currency",
        "expert_provider_operations_kind",
        "expert_provider_operations_manual_review",
        "expert_provider_operations_mode",
        "expert_provider_operations_parent",
        "expert_provider_operations_provider",
        "expert_provider_operations_provider_id",
        "expert_provider_operations_recovery_attempt",
        "expert_provider_operations_recovery_lease",
        "expert_provider_operations_replay_bundle",
        "expert_provider_operations_request_digest",
        "expert_provider_operations_resolution",
        "expert_provider_operations_status",
      ],
      foreignKeys: [
        "expert_provider_operations_attempt_order_fk",
        "expert_provider_operations_order_fk",
      ],
      indexes: [
        "expert_provider_operations_command_unique",
        "expert_provider_operations_idempotency_unique",
        "expert_provider_operations_object_unique",
        "expert_provider_operations_order_kind_idx",
        "expert_provider_operations_reconcile_idx",
        "expert_provider_operations_unbound_recovery_idx",
      ],
    });
    expect(requiredTable("expertFirstResidencySettlements")).toMatchObject({
      foreignKeys: expect.arrayContaining([
        "expert_first_settlement_order_owner_fk",
        "expert_first_settlement_payment_order_fk",
        "expert_first_settlement_referral_invitee_fk",
      ]),
      uniques: expect.arrayContaining([
        "expert_first_settlement_identity_unique",
      ]),
    });
    expect(requiredTable("expertReferralRewardGrants")).toMatchObject({
      checks: [
        "expert_reward_grant_exact_amount",
        "expert_reward_grant_expiry_exact",
      ],
      foreignKeys: expect.arrayContaining([
        "expert_reward_grants_first_marker_fk",
        "expert_reward_grants_referral_inviter_fk",
      ]),
      uniques: [
        "expert_reward_grants_first_settlement_unique",
        "expert_reward_grants_id_expert_unique",
        "expert_reward_grants_idempotency_unique",
        "expert_reward_grants_maturity_unique",
        "expert_reward_grants_qualifying_order_unique",
        "expert_reward_grants_qualifying_payment_unique",
        "expert_reward_grants_referral_unique",
      ],
    });
    expect(requiredTable("expertReferralMaturities")).toMatchObject({
      checks: [
        "expert_referral_maturity_attempt_bounded",
        "expert_referral_maturity_idempotency_nonempty",
        "expert_referral_maturity_policy",
        "expert_referral_maturity_settled_clock",
        "expert_referral_maturity_terminal_state",
      ],
      foreignKeys: [
        "expert_referral_maturity_settlement_fk",
        "expert_referral_reward_maturities_invitee_expert_id_experts_id_fk",
        "expert_referral_reward_maturities_inviter_expert_id_experts_id_fk",
      ],
      indexes: ["expert_referral_maturities_due_idx"],
      uniques: [
        "expert_referral_maturities_idempotency_unique",
        "expert_referral_maturities_order_unique",
        "expert_referral_maturities_payment_unique",
        "expert_referral_maturities_referral_unique",
        "expert_referral_maturities_settlement_unique",
      ],
    });
    expect(requiredTable("expertReferralLedgerEntries")?.uniques).toContain(
      "expert_ledger_entries_id_expert_unique",
    );
    expect(requiredTable("expertReferralLedgerAllocations")).toMatchObject({
      checks: ["expert_ledger_allocation_nonzero"],
      foreignKeys: [
        "expert_ledger_allocations_entry_owner_fk",
        "expert_ledger_allocations_grant_owner_fk",
      ],
    });
    expect(requiredTable("expertReferralFeatureControls")).toMatchObject({
      checks: [
        "expert_referral_controls_singleton",
        "expert_referral_controls_version_positive",
      ],
    });
  });

  it("describes every named migration constraint and partial index", () => {
    expect(names(channelIdentities)).toMatchObject({
      indexes: [
        "channel_identities_provider_external_legacy_unique",
        "channel_identities_telegram_bot_user_chat_unique",
      ],
      uniques: [],
    });
    expect(names(clientProfiles).checks).toEqual([
      "client_profiles_expert_note_bounded",
    ]);
    expect(names(clientSessions)).toMatchObject({
      checks: [
        "client_sessions_lifecycle_check",
        "client_sessions_scope_check",
        "client_sessions_token_digest_check",
      ],
      indexes: ["client_sessions_expiry_idx"],
    });
    expect(names(clientIdentityProofReceipts)).toMatchObject({
      checks: [
        "client_identity_proof_receipts_expiry_check",
        "client_identity_proof_receipts_replay_digest_check",
        "client_identity_proof_receipts_session_digest_check",
      ],
      indexes: ["client_identity_proof_receipts_expiry_idx"],
      uniques: ["client_identity_proof_receipts_session_digest_unique"],
    });
    expect(names(slots)).toMatchObject({
      checks: ["slots_capacity_positive"],
      uniques: ["slots_provider_external_unique"],
    });
    expect(names(messagePackages)).toMatchObject({
      checks: [
        "message_packages_admin_binding_complete",
        "message_packages_admin_contract",
        "message_packages_grant_positive",
        "message_packages_kind_allowed",
      ],
      indexes: ["message_packages_eligible_order"],
      uniques: ["message_packages_grant_idempotency_unique"],
    });
    expect(names(messageEvents).uniques).toEqual([
      "message_events_provider_external_unique",
    ]);
    expect(names(messageLedgerEntries)).toMatchObject({
      checks: [
        "message_ledger_admin_binding_complete",
        "message_ledger_delta_matches_kind",
      ],
      indexes: [
        "message_ledger_compensation_once_per_original",
        "message_ledger_grant_once_per_package",
        "message_ledger_message_fact_once",
        "message_ledger_revocation_once_per_package_grant",
      ],
      uniques: ["message_ledger_idempotency_unique"],
    });
    expect(names(messageLedgerEntries).foreignKeys).toContain(
      "message_ledger_original_entry_fk",
    );
    expect(names(reservations)).toMatchObject({
      checks: [
        "reservations_deadline_after_creation",
        "reservations_meeting_url_https",
        "reservations_version_positive",
      ],
      indexes: [
        "reservations_client_active_overlap",
        "reservations_expert_active_overlap",
      ],
      uniques: ["reservations_idempotency_unique"],
    });
    expect(names(notifications)).toMatchObject({
      indexes: ["notifications_callback_token_hash_unique"],
      uniques: ["notifications_idempotency_unique"],
    });
    expect(names(integrationInbox).uniques).toEqual([
      "integration_inbox_provider_event_unique",
    ]);
    expect(names(integrationOutbox)).toMatchObject({
      checks: [
        "integration_outbox_attempts_nonnegative",
        "integration_outbox_dialogue_order_pair",
        "integration_outbox_dialogue_sequence_positive",
        "integration_outbox_reconciliation_key_present",
      ],
      indexes: [
        "integration_outbox_dialogue_order_claim_idx",
        "integration_outbox_dialogue_sequence_unique",
        "integration_outbox_dispatch_lease",
        "integration_outbox_reconciliation_lease",
      ],
      uniques: ["integration_outbox_idempotency_unique"],
    });
    expect(names(dialogues).checks).toContain(
      "dialogues_delivery_sequence_nonnegative",
    );
    expect(names(selartiResponseProposals)).toMatchObject({
      checks: [
        "selarti_response_proposals_expiry_check",
        "selarti_response_proposals_hash_check",
        "selarti_response_proposals_redaction_check",
        "selarti_response_proposals_text_check",
      ],
      indexes: ["selarti_response_proposals_expiry_idx"],
      uniques: ["selarti_response_proposals_request_id_unique"],
    });
    expect(names(dialogueDeliveries)).toMatchObject({
      indexes: ["dialogue_deliveries_order_idx"],
      uniques: [
        "dialogue_deliveries_dialogue_sequence_unique",
        "dialogue_deliveries_outbox_id_unique",
        "dialogue_deliveries_source_unique",
      ],
    });
    expect(names(dialogueInboundTombstones).uniques).toEqual([
      "dialogue_inbound_tombstones_scope_unique",
    ]);
    expect(names(promptVersions).uniques).toEqual([
      "prompt_versions_name_version_unique",
    ]);
    expect(names(adminApprovals)).toMatchObject({
      checks: [
        "admin_approvals_binding_complete",
        "admin_approvals_lifecycle_order",
        "admin_approvals_required_role_allowed",
      ],
      indexes: ["admin_approvals_bound_scope_nonce_unique"],
      uniques: [],
    });
    expect(names(adminCaseActions)).toMatchObject({
      checks: [
        "admin_case_actions_action_allowed",
        "admin_case_actions_object_type_allowed",
      ],
      uniques: [
        "admin_case_actions_approval_unique",
        "admin_case_actions_object_action_unique",
      ],
    });
    expect(names(integrationErrors).checks).toEqual([
      "integration_errors_status_allowed",
    ]);
    expect(names(adminSessions)).toMatchObject({
      checks: ["admin_sessions_lifecycle_order"],
      foreignKeys: ["admin_sessions_admin_id_users_id_fk"],
    });
    expect(names(adminRoleAssignments)).toMatchObject({
      checks: ["admin_role_assignments_role_allowed"],
      uniques: ["admin_role_assignments_admin_role_unique"],
    });
    expect(names(adminObjectAssignments)).toMatchObject({
      checks: ["admin_object_assignments_type_allowed"],
      uniques: ["admin_object_assignments_scope_unique"],
    });
    expect(names(privacyDeletionJobs).uniques).toEqual([
      "privacy_deletion_jobs_subject_idempotency_unique",
    ]);
    expect(names(privacyProcessorAttempts).uniques).toEqual([
      "privacy_processor_attempts_idempotency_unique",
      "privacy_processor_attempts_job_processor_unique",
    ]);
    expect(names(privacyDeletionManifests).uniques).toEqual([
      "privacy_deletion_manifests_job_processor_unique",
    ]);
    expect(names(providerSubjectMappings).uniques).toEqual([
      "provider_subject_mappings_provider_token_unique",
    ]);
    expect(names(privacyRetentionItems).uniques).toEqual([]);
    expect(names(providerCursors).uniques).toEqual([
      "provider_cursors_provider_unique",
    ]);
    expect(names(projectionCheckpoints).uniques).toEqual([
      "projection_checkpoints_projection_unique",
    ]);
  });

  it("exports the ledger-derived package balance view", () => {
    const view = (dbSchema as Record<string, unknown>).packageBalances;
    expect(view).toBeDefined();
    if (view !== undefined) {
      expect(getViewConfig(view as PgView).name).toBe("package_balances");
    }
  });

  it("keeps the migration SQL and Drizzle metadata names synchronized", () => {
    const migration = [
      readFileSync("packages/db/migrations/0000_mvp.sql", "utf8"),
      readFileSync(
        "packages/db/migrations/0001_message-package-metadata.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0002_atomic-message-accounting.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0003_booking-concurrency.sql",
        "utf8",
      ),
      readFileSync("packages/db/migrations/0004_durable_outbox.sql", "utf8"),
      readFileSync(
        "packages/db/migrations/0005_outbox_fencing_tokens.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0006_telegram-callback-expert-fk.sql",
        "utf8",
      ),
      readFileSync("packages/db/migrations/0015_admin_iam.sql", "utf8"),
      readFileSync(
        "packages/db/migrations/0018_expert_residency_referrals.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0023_yookassa_provider_operations.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0024_yookassa_encrypted_recovery.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0025_expert_telegram_residency_callbacks.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0026_expert_telegram_checkout_outcomes.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0027_expert_ai_request_receipts.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0028_operator_case_inbox.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0029_client_catalog_requests.sql",
        "utf8",
      ),
      readFileSync("packages/db/migrations/0030_client_sessions.sql", "utf8"),
      readFileSync(
        "packages/db/migrations/0031_client_booking_references.sql",
        "utf8",
      ),
      readFileSync(
        "packages/db/migrations/0035_hybrid_message_gateway_b2.sql",
        "utf8",
      ),
    ].join("\n");
    const requiredNames = [
      "channel_identities_provider_external_unique",
      "slots_provider_external_unique",
      "slots_capacity_positive",
      "message_packages_grant_positive",
      "message_packages_grant_idempotency_unique",
      "message_packages_kind_allowed",
      "message_packages_eligible_order",
      "message_events_provider_external_unique",
      "message_ledger_idempotency_unique",
      "message_ledger_original_entry_fk",
      "message_ledger_delta_matches_kind",
      "message_ledger_message_fact_once",
      "message_ledger_grant_once_per_package",
      "message_ledger_compensation_once_per_original",
      "message_ledger_revocation_once_per_package_grant",
      "reservations_idempotency_unique",
      "reservations_version_positive",
      "reservations_deadline_after_creation",
      "reservations_client_active_overlap",
      "reservations_expert_active_overlap",
      "notifications_idempotency_unique",
      "notifications_callback_token_hash_unique",
      "integration_inbox_provider_event_unique",
      "integration_outbox_idempotency_unique",
      "integration_outbox_reconciliation_key_present",
      "integration_outbox_attempts_nonnegative",
      "integration_outbox_dispatch_lease",
      "integration_outbox_reconciliation_lease",
      "prompt_versions_name_version_unique",
      "admin_approvals_bound_scope_nonce_unique",
      "admin_approvals_required_role_allowed",
      "admin_approvals_binding_complete",
      "admin_approvals_lifecycle_order",
      "admin_sessions_lifecycle_order",
      "admin_sessions_admin_id_users_id_fk",
      "admin_role_assignments_admin_role_unique",
      "admin_role_assignments_role_allowed",
      "admin_object_assignments_scope_unique",
      "admin_object_assignments_type_allowed",
      "privacy_deletion_jobs_subject_idempotency_unique",
      "privacy_processor_attempts_job_processor_unique",
      "provider_cursors_provider_unique",
      "projection_checkpoints_projection_unique",
      "integration_inbox_message_event_id_message_events_id_fk",
      "notifications_callback_expert_id_experts_id_fk",
      "experts_user_id_unique",
      "expert_referrals_code_unique",
      "expert_referrals_invitee_unique",
      "expert_referrals_distinct_experts",
      "expert_tariff_active_interval_exclusion",
      "expert_order_credit_cap",
      "expert_order_cash_remainder",
      "expert_reward_grant_exact_amount",
      "expert_first_settlement_expert_unique",
      "expert_abuse_holds_one_open_per_expert",
      "expert_referral_controls_singleton",
      "expert_provider_event_unique",
      "expert_referral_append_only",
      "expert_first_settlement_guard",
      "expert_reward_grants_eligible_settlement",
      "expert_ledger_allocations_exact_total",
      "expert_provider_operations_order_fk",
      "expert_provider_operations_attempt_order_fk",
      "expert_provider_operations_command_unique",
      "expert_provider_operations_idempotency_unique",
      "expert_provider_operations_object_unique",
      "expert_provider_operations_reconcile_idx",
      "expert_provider_operations_order_kind_idx",
      "expert_provider_operations_unbound_recovery_idx",
      "expert_receipt_contacts_append_only",
      "expert_telegram_residency_callbacks_checkout_outcome_check",
      "expert_telegram_residency_callbacks_checkout_state_check",
      "expert_telegram_residency_callbacks_processing_lease_check",
      "expert_telegram_residency_callbacks_processing_lease_idx",
      "expert_telegram_residency_callbacks_url_cleanup_idx",
      "expert_ai_request_receipts_hashes_check",
      "expert_ai_request_receipts_status_check",
      "expert_ai_request_receipts_version_check",
      "expert_ai_request_receipts_state_check",
      "expert_ai_request_receipts_lease_idx",
      "expert_ai_request_receipts_cleanup_idx",
      "outbox_operator_alerts_case_type_check",
      "outbox_operator_alerts_status_check",
      "outbox_operator_alerts_case_reason_check",
      "outbox_operator_alerts_payload_check",
      "outbox_operator_alerts_lifecycle_check",
      "outbox_operator_alerts_unresolved_cursor_idx",
      "client_sessions_token_digest_check",
      "client_sessions_scope_check",
      "client_sessions_lifecycle_check",
      "client_sessions_expiry_idx",
      "client_identity_proof_receipts_replay_digest_check",
      "client_identity_proof_receipts_session_digest_check",
      "client_identity_proof_receipts_expiry_check",
      "client_identity_proof_receipts_session_digest_unique",
      "client_identity_proof_receipts_expiry_idx",
      "client_catalog_choices_choice_digest_check",
      "client_catalog_choices_choice_digest_unique",
      "client_catalog_choices_expiry_check",
      "client_catalog_choices_request_expiry_idx",
      "client_booking_receipts_user_choice_unique",
      "client_booking_receipts_booking_handle_unique",
      "client_booking_receipts_reservation_unique",
      "client_booking_receipts_choice_digest_check",
      "client_booking_receipts_booking_handle_check",
      "client_booking_receipts_owner_handle_idx",
      "client_booking_erasure_work_phase_check",
      "client_booking_erasure_work_attempt_count_check",
      "client_booking_erasure_work_lease_check",
      "client_booking_erasure_work_claim_idx",
    ];
    for (const name of requiredNames) expect(migration).toContain(name);
    expect(migration).toContain(
      'char_length("checkout_url") BETWEEN 1 AND 2048',
    );
    expect(migration).toContain('"checkout_url" IS NOT NULL');
    expect(migration).toContain('"checkout_url" ~* \'^https://');
    expect(migration).not.toContain("{1,2040}");
    expect(migration).toMatch(
      /select eligibility[\s\S]{1,600}from expert_first_residency_settlements[\s\S]{1,600}for update/iu,
    );
  });

  it("keeps the principal migration directly before client booking", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const principal = journal.entries.find(
      (entry) => entry.tag === "0030_client_sessions",
    );
    expect(principal).toMatchObject({
      idx: 30,
      tag: "0030_client_sessions",
    });
    const booking = journal.entries.find(
      (entry) => entry.tag === "0031_client_booking_references",
    );
    expect(principal?.when).toBeLessThan(
      booking?.when ?? Number.POSITIVE_INFINITY,
    );
  });

  it("registers the protected client booking relations as migration 0031", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0031_client_booking_references",
      ),
    ).toMatchObject({
      idx: 31,
      tag: "0031_client_booking_references",
    });
    expect(
      journal.entries.find(
        (entry) => entry.tag === "0032_commercial_core_v2_a1",
      ),
    ).toMatchObject({
      idx: 32,
      tag: "0032_commercial_core_v2_a1",
    });
    expect(
      existsSync("packages/db/migrations/0031_client_booking_references.sql"),
    ).toBe(true);
    for (const exportName of [
      "clientCatalogChoices",
      "clientBookingReceipts",
      "clientBookingErasureWork",
    ]) {
      expect(dbSchema, exportName).toHaveProperty(exportName);
    }
  });

  it("has a coherent latest Drizzle snapshot", () => {
    const path = "packages/db/migrations/meta/0018_snapshot.json";
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      tables?: Record<string, unknown>;
      views?: Record<string, unknown>;
    };
    expect(Object.keys(snapshot.tables ?? {})).toHaveLength(54);
    expect(snapshot.views).toHaveProperty("public.package_balances");
    expect(snapshot.views).toHaveProperty("public.expert_referral_balances");
    const balanceView = snapshot.views?.["public.expert_referral_balances"] as
      { definition?: string } | undefined;
    expect(balanceView?.definition).toContain("having sum(a.amount_minor) > 0");
    const expertsTable = snapshot.tables?.["public.experts"] as
      { uniqueConstraints?: Record<string, unknown> } | undefined;
    expect(expertsTable?.uniqueConstraints).toHaveProperty(
      "experts_user_id_unique",
    );
    const notificationsTable = snapshot.tables?.["public.notifications"] as
      | {
          foreignKeys?: Record<string, unknown>;
        }
      | undefined;
    expect(notificationsTable?.foreignKeys).toHaveProperty(
      "notifications_callback_expert_id_experts_id_fk",
    );
  });

  it("keeps booking migration upgrade-safe and historical slots stale", () => {
    const migration = readFileSync(
      "packages/db/migrations/0003_booking-concurrency.sql",
      "utf8",
    ).toLowerCase();
    expect(migration).toContain(
      'add column "observed_at" timestamp with time zone;',
    );
    expect(migration).not.toContain(
      '"observed_at" timestamp with time zone default now()',
    );
    expect(migration).toContain('add column "slot_id" uuid;');
    expect(migration).toContain('add column "expert_id" uuid;');
    expect(migration).toContain('update "reservations"');
    expect(migration).toContain("booking_slot_backfill_ambiguous");
    expect(migration).toContain('alter column "slot_id" set not null');
    expect(migration).toContain('alter column "expert_id" set not null');

    const snapshot = JSON.parse(
      readFileSync("packages/db/migrations/meta/0003_snapshot.json", "utf8"),
    ) as {
      tables?: Record<
        string,
        {
          columns?: Record<string, { notNull?: boolean; default?: unknown }>;
        }
      >;
    };
    const slotColumns = snapshot.tables?.["public.slots"]?.columns;
    const reservationColumns =
      snapshot.tables?.["public.reservations"]?.columns;
    expect(slotColumns?.observed_at).toMatchObject({ notNull: false });
    expect(slotColumns?.observed_at?.default).toBeUndefined();
    expect(reservationColumns?.slot_id).toMatchObject({ notNull: true });
    expect(reservationColumns?.expert_id).toMatchObject({ notNull: true });
  });

  it("deduplicates legacy dead letters deterministically before enforcing uniqueness", () => {
    const migration = readFileSync(
      "packages/db/migrations/0004_durable_outbox.sql",
      "utf8",
    );
    const dedupe = migration.indexOf("ranked_dead_letters");
    const unique = migration.indexOf("dead_letters_outbox_unique");
    expect(dedupe).toBeGreaterThan(-1);
    expect(migration).toContain('PARTITION BY "outbox_id"');
    expect(migration).toContain('ORDER BY "created_at", "id"');
    expect(migration).toContain("duplicate_rank > 1");
    expect(unique).toBeGreaterThan(dedupe);
  });

  it("passes the granted message count into package metadata", () => {
    const testkit = readFileSync("packages/db/src/testkit/postgres.ts", "utf8");
    expect(testkit).toMatch(
      /createLedgerPackage\(\s*primaryUserId,\s*`package-\$\{externalMessageId\}`,\s*grantedMessages,\s*\)/,
    );
    expect(testkit).toContain(
      "values (${userId}::uuid, ${grantedMessages}, ${grantIdempotencyKey})",
    );
  });
});
