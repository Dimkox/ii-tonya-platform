import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase | undefined;

type DatabaseErrorEvidence = {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
  cause?: unknown;
};

function databaseErrorChain(error: unknown): DatabaseErrorEvidence[] {
  const chain: DatabaseErrorEvidence[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const evidence = current as DatabaseErrorEvidence;
    chain.push(evidence);
    current = evidence.cause;
  }
  return chain;
}

async function applySqlMigration(
  db: TestDatabase["db"],
  path: string,
): Promise<void> {
  const statements = readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function applyLegacyBaseline(db: TestDatabase["db"]): Promise<void> {
  for (const path of [
    "packages/db/migrations/0000_mvp.sql",
    "packages/db/migrations/0001_message-package-metadata.sql",
    "packages/db/migrations/0002_atomic-message-accounting.sql",
  ]) {
    await applySqlMigration(db, path);
  }
}

async function seedLegacyReservation(
  db: TestDatabase["db"],
  slotCount: number,
): Promise<void> {
  await db.execute(
    sql.raw(`
    insert into users (id) values
      ('00000000-0000-4000-8000-000000000001'),
      ('00000000-0000-4000-8000-000000000002');
    insert into experts (id, user_id, active, verified) values (
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000002',
      true,
      true
    );
    insert into expert_services (
      id, expert_id, name, active, duration_minutes
    ) values (
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000003',
      'Legacy service',
      true,
      60
    );
    insert into slots (
      id, expert_service_id, provider, external_slot_id,
      starts_at, ends_at, capacity
    ) values (
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000004',
      'legacy',
      'legacy-slot-1',
      '2026-08-02T10:00:00.000Z',
      '2026-08-02T11:00:00.000Z',
      1
    );
    ${
      slotCount === 2
        ? `
    insert into slots (
      id, expert_service_id, provider, external_slot_id,
      starts_at, ends_at, capacity
    ) values (
      '00000000-0000-4000-8000-000000000006',
      '00000000-0000-4000-8000-000000000004',
      'legacy',
      'legacy-slot-2',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T11:00:00.000Z',
      1
    );`
        : ""
    }
    insert into reservations (
      id, user_id, expert_service_id, status, idempotency_key,
      reserved_until, version, created_at, updated_at
    ) values (
      '00000000-0000-4000-8000-000000000007',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000004',
      'reserved',
      'legacy-reservation',
      '2026-08-01T10:00:00.000Z',
      1,
      '2026-07-28T10:00:00.000Z',
      '2026-07-28T10:00:00.000Z'
    );
  `),
  );
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught, "database operation should fail").toBeDefined();
  const chain = databaseErrorChain(caught);
  expect(
    chain.some(
      (error) =>
        error.code === expected.code &&
        (expected.constraint === undefined ||
          error.constraint === expected.constraint),
    ),
    `expected SQLSTATE ${expected.code}${expected.constraint ? ` / ${expected.constraint}` : ""}`,
  ).toBe(true);
}

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 120_000);

afterAll(async () => testDb?.stop(), 60_000);

describe("MVP schema", () => {
  it("resets the migrated schema without weakening replay-ledger triggers", async () => {
    await testDb!.reset();
    const triggers = await testDb!.db.execute<{
      name: string;
      enabled: string;
    }>(sql`
      select tgname as name, tgenabled as enabled
      from pg_trigger
      where tgrelid = 'expert_referral_admin_execution_results'::regclass
        and tgname in (
          'expert_referral_admin_results_immutable',
          'expert_referral_admin_results_truncate_immutable'
        )
      order by tgname
    `);
    expect(triggers.rows).toEqual([
      { name: "expert_referral_admin_results_immutable", enabled: "O" },
      {
        name: "expert_referral_admin_results_truncate_immutable",
        enabled: "O",
      },
    ]);
  }, 30_000);

  it("creates the authoritative MVP and operational-support tables", async () => {
    const rows = await testDb!.db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `);
    const names = rows.rows.map((row) => row.table_name);
    // Literal union inventory verified against the PostgreSQL-derived0084 state.
    expect(names).toEqual([
      "admin_approvals",
      "admin_case_actions",
      "admin_object_assignments",
      "admin_role_assignments",
      "admin_sessions",
      "audit_events",
      "booking_handoff_revocation_receipts",
      "booking_notification_attempt_facts",
      "booking_notification_attempts",
      "booking_notification_bot_controls",
      "booking_notification_callbacks",
      "booking_notification_contexts",
      "booking_notification_deliveries",
      "booking_reschedule_facts",
      "booking_waitlist_command_receipts",
      "booking_waitlist_entries",
      "channel_identities",
      "client_booking_erasure_work",
      "client_booking_receipts",
      "client_catalog_choices",
      "client_catalog_erasure_index",
      "client_catalog_requests",
      "client_catalog_snapshots",
      "client_catalog_tombstones",
      "client_commercial_policy_assignments",
      "client_commercial_policy_controls",
      "client_coupon_grants",
      "client_erasure_requests",
      "client_identity_proof_receipts",
      "client_paid_orders",
      "client_paid_payment_bindings",
      "client_paid_settlements",
      "client_profiles",
      "client_session_booking_grants",
      "client_sessions",
      "commercial_participants",
      "consent_document_versions",
      "consent_presentations",
      "consent_states",
      "consents",
      "conversation_messages",
      "conversations",
      "dead_letters",
      "delivery_attempts",
      "dialogue_deliveries",
      "dialogue_inbound",
      "dialogue_inbound_tombstones",
      "dialogue_route_decisions",
      "dialogues",
      "early_bird_admission_candidates",
      "early_bird_admissions",
      "early_bird_candidate_observations",
      "early_bird_choices",
      "early_bird_composite_intents",
      "early_bird_composite_requests",
      "early_bird_coverage_epochs",
      "early_bird_coverage_reconciliation",
      "early_bird_coverage_revisions",
      "early_bird_deferred_accounts",
      "early_bird_deferred_effective_coverages",
      "early_bird_deferred_invoices",
      "early_bird_deferred_onboarded",
      "early_bird_deferred_receipt_contacts",
      "early_bird_deferred_receipt_tombstones",
      "early_bird_deferred_refund_facts",
      "early_bird_deferred_refund_reconciliation",
      "early_bird_deferred_refund_resolutions",
      "early_bird_deferred_requests",
      "early_bird_deferred_verified_bindings",
      "early_bird_deferred_verified_refund_bindings",
      "early_bird_effective_coverages",
      "early_bird_final_call_engagements",
      "early_bird_final_call_policy",
      "early_bird_final_call_queue",
      "early_bird_form_bridges",
      "early_bird_form_enrollments",
      "early_bird_gateway_claims",
      "early_bird_gateway_contact_state",
      "early_bird_intent_tombstones",
      "early_bird_launch_configs",
      "early_bird_launch_kit_jobs",
      "early_bird_message_dispatch_claims",
      "early_bird_message_dispatch_consumptions",
      "early_bird_message_replacements",
      "early_bird_payment_full_refunds",
      "early_bird_payment_successes",
      "early_bird_positive_price_snapshots",
      "early_bird_receipt_contacts",
      "early_bird_refund_binding_registry",
      "early_bird_refund_reconciliation",
      "early_bird_refund_registry",
      "early_bird_unknown_recovery",
      "early_bird_verified_bindings",
      "early_bird_verified_refund_bindings",
      "early_bird_wave_one_exclusions",
      "expert_ai_request_receipts",
      "expert_application_material_jobs",
      "expert_application_promo_confirmations",
      "expert_application_promo_proofs",
      "expert_campaign_anchors",
      "expert_campaign_quotes",
      "expert_card_consent_epoch",
      "expert_card_draft_tags",
      "expert_card_drafts",
      "expert_card_entries",
      "expert_card_handoffs",
      "expert_card_main_acceptances",
      "expert_card_main_orders",
      "expert_card_material_jobs",
      "expert_card_material_templates",
      "expert_card_promo_confirmations",
      "expert_card_promo_proofs",
      "expert_card_requests",
      "expert_card_reviews",
      "expert_card_staff_actions",
      "expert_first_residency_settlements",
      "expert_identity_proof_receipts",
      "expert_main_activation_admissions",
      "expert_manager_telegram_callbacks",
      "expert_manager_telegram_notifications",
      "expert_manager_telegram_pairings",
      "expert_offer_profile_verifications",
      "expert_offer_profiles",
      "expert_offer_schedules",
      "expert_onboarding_applications",
      "expert_onboarding_invoices",
      "expert_onboarding_payment_facts",
      "expert_onboarding_payment_operations",
      "expert_personal_offer_notices",
      "expert_personal_offer_state",
      "expert_promo_bonus_indications",
      "expert_promo_codes",
      "expert_promo_enrollments",
      "expert_promo_guide_work",
      "expert_promo_manager_work",
      "expert_promo_qualification_audits",
      "expert_promo_ready_logs",
      "expert_promo_registrations",
      "expert_promo_requests",
      "expert_referral_abuse_holds",
      "expert_referral_admin_execution_results",
      "expert_referral_balances",
      "expert_referral_code_batches",
      "expert_referral_codes",
      "expert_referral_feature_controls",
      "expert_referral_issuance_overrides",
      "expert_referral_ledger_allocations",
      "expert_referral_ledger_entries",
      "expert_referral_reward_grants",
      "expert_referral_reward_maturities",
      "expert_referrals",
      "expert_residency_lifecycle",
      "expert_residency_lifecycle_audits",
      "expert_residency_lifecycle_notices",
      "expert_residency_orders",
      "expert_residency_payment_attempts",
      "expert_residency_provider_event_inbox",
      "expert_residency_provider_operations",
      "expert_residency_receipt_contacts",
      "expert_residency_renewal_attempts",
      "expert_residency_renewal_bills",
      "expert_residency_tariff_versions",
      "expert_sales_bases",
      "expert_sales_choices",
      "expert_sales_erased_cohorts",
      "expert_sales_fee_attempts",
      "expert_sales_form_bridges",
      "expert_sales_notices",
      "expert_sales_operator_recoveries",
      "expert_sales_paid_locks",
      "expert_sales_provider_observations",
      "expert_sales_provider_requests",
      "expert_sales_recovery_work",
      "expert_sales_selections",
      "expert_sales_ticks",
      "expert_services",
      "expert_sessions",
      "expert_space_tariff_approvals",
      "expert_telegram_residency_callbacks",
      "expert_verification_decisions",
      "expert_verification_work",
      "experts",
      "experts_published",
      "feedback",
      "forbidden_patterns",
      "hashtags_db",
      "hashtags_taxonomy",
      "human_escalations",
      "integration_errors",
      "integration_inbox",
      "integration_outbox",
      "lifecycle_jobs",
      "message_events",
      "message_ledger_entries",
      "message_packages",
      "notifications",
      "organization_profiles",
      "outbox_operator_alerts",
      "owner_test_pricing_grants",
      "package_balances",
      "partner_command_receipts",
      "partner_shadow_quotes",
      "partner_tariff_policy_versions",
      "payer_receipt_contacts",
      "payer_receipt_order_bindings",
      "planerka_account_requests",
      "planerka_availability_refreshes",
      "planerka_booking_operations",
      "planerka_legacy_booking_reviews",
      "planerka_service_mappings",
      "privacy_deletion_jobs",
      "privacy_deletion_manifests",
      "privacy_processor_attempts",
      "privacy_retention_items",
      "projection_checkpoints",
      "prompt_versions",
      "provider_cursors",
      "provider_subject_mappings",
      "public_expert_payment_observations",
      "public_expert_payment_requests",
      "public_expert_payment_resolutions",
      "public_expert_provider_identities",
      "receipt_revocation_outbox",
      "reconciliation_mismatches",
      "reconciliation_runs",
      "reservations",
      "resident_card_corrections",
      "resident_card_media",
      "resident_card_proposal_changes",
      "resident_card_versions",
      "resident_check_generations",
      "resident_document_access_audit",
      "resident_evidence_jobs",
      "resident_information_requests",
      "resident_lifecycle_cases",
      "resident_lifecycle_subjects",
      "resident_message_templates",
      "resident_native_confirmations",
      "resident_native_logistics",
      "resident_native_slots",
      "resident_object_deletions",
      "resident_private_objects",
      "resident_review_events",
      "resident_review_messages",
      "resident_review_previews",
      "resident_review_recoveries",
      "resident_safety_active",
      "resident_safety_outcomes",
      "resident_safety_policies",
      "resident_safety_publications",
      "resident_sales_application",
      "resident_schedule_busy",
      "resident_schedule_previews",
      "resident_schedule_state",
      "resident_schedule_versions",
      "resident_service_mappings",
      "resident_service_versions",
      "resident_social_observations",
      "resident_tag_decisions",
      "resident_verification_application_updates",
      "resident_verification_check_work",
      "resident_verification_cohorts",
      "resident_verification_requests",
      "resident_work_bot_state",
      "resident_work_notice_attempts",
      "resident_work_notices",
      "resident_workspace_access",
      "residents_applications",
      "safety_incidents",
      "security_logs",
      "selarti_actual_usage_facts",
      "selarti_budget_alerts",
      "selarti_budget_policies",
      "selarti_cost_adjustments",
      "selarti_cost_reservations",
      "selarti_response_proposals",
      "slots",
      "tag_embeddings_cache",
      "test_expert_audit_events",
      "test_expert_campaign_versions",
      "test_expert_deterministic_requests",
      "test_expert_lifecycle_audit_events",
      "test_expert_outcomes",
      "test_expert_prompt_assets",
      "test_expert_redemptions",
      "test_expert_reservations",
      "test_expert_sessions",
      "users",
      "webhook_inbox",
    ]);
  });

  it("uses an append-only ledger-derived balance with no mutable remainder column", async () => {
    await testDb!.seedUserAndPackage({
      externalMessageId: "m-1",
      grantedMessages: 2,
    });
    expect(await testDb!.packageGrantedMessages()).toBe(2);
    await expect(
      testDb!.insertDuplicateExternalMessage("m-1"),
    ).rejects.toThrow();
    expect(
      await testDb!.columnExists("message_packages", "remaining_messages"),
    ).toBe(false);
    expect(await testDb!.packageBalance()).toBe(2);
    await testDb!.appendLedgerFact({
      kind: "debit",
      delta: -1,
      idempotencyKey: "debit-1",
    });
    expect(await testDb!.packageBalance()).toBe(1);
    await expectDatabaseError(() => testDb!.updateLedgerFact("debit-1", 0), {
      code: "55000",
    });
    await expectDatabaseError(() => testDb!.deleteLedgerFact("debit-1"), {
      code: "55000",
    });
  });

  it("allows grants across clients/packages while rejecting only same-scope corrections", async () => {
    const clientA = await testDb!.createUser();
    const clientB = await testDb!.createUser();
    const packageA1 = await testDb!.createLedgerPackage(clientA, "grant-a1");
    const packageA2 = await testDb!.createLedgerPackage(clientA, "grant-a2");
    const packageB1 = await testDb!.createLedgerPackage(clientB, "grant-b1");

    const grantA1 = await testDb!.appendGrantFact(
      packageA1,
      500,
      "ledger-grant-a1",
    );
    const grantA2 = await testDb!.appendGrantFact(
      packageA2,
      1000,
      "ledger-grant-a2",
    );
    const grantB1 = await testDb!.appendGrantFact(
      packageB1,
      500,
      "ledger-grant-b1",
    );
    expect([grantA1, grantA2, grantB1]).toHaveLength(3);
    await expectDatabaseError(
      () => testDb!.appendGrantFact(packageA1, 500, "ledger-grant-a1-again"),
      { code: "23505", constraint: "message_ledger_grant_once_per_package" },
    );

    const debitA = await testDb!.appendMessageDebit(
      packageA1,
      "message-a",
      "debit-a",
    );
    const debitB = await testDb!.appendMessageDebit(
      packageB1,
      "message-b",
      "debit-b",
    );
    await testDb!.appendCompensation(packageA1, debitA, "comp-a");
    await testDb!.appendCompensation(packageB1, debitB, "comp-b");
    await expectDatabaseError(
      () => testDb!.appendCompensation(packageA1, debitA, "comp-a-again"),
      {
        code: "23505",
        constraint: "message_ledger_compensation_once_per_original",
      },
    );

    await testDb!.appendRevocation(packageA1, grantA1, "revoke-a1");
    await testDb!.appendRevocation(packageB1, grantB1, "revoke-b1");
    await expectDatabaseError(
      () => testDb!.appendRevocation(packageA1, grantA1, "revoke-a1-again"),
      {
        code: "23505",
        constraint: "message_ledger_revocation_once_per_package_grant",
      },
    );
    expect(
      await testDb!.ledgerFactCount([packageA1, packageA2, packageB1]),
    ).toBe(9);
  });

  it("upgrades an unambiguous legacy reservation through migration 0003", async () => {
    const legacyDb = await startTestPostgres();
    try {
      await applyLegacyBaseline(legacyDb.db);
      await seedLegacyReservation(legacyDb.db, 1);
      await applySqlMigration(
        legacyDb.db,
        "packages/db/migrations/0003_booking-concurrency.sql",
      );

      const result = await legacyDb.db.execute<{
        slotId: string | null;
        expertId: string | null;
        observedAt: Date | null;
      }>(sql`
        select
          r.slot_id as "slotId",
          r.expert_id as "expertId",
          s.observed_at as "observedAt"
        from reservations r
        join slots s on s.id = r.slot_id
        where r.id = '00000000-0000-4000-8000-000000000007'::uuid
      `);
      expect(result.rows[0]).toEqual({
        slotId: "00000000-0000-4000-8000-000000000005",
        expertId: "00000000-0000-4000-8000-000000000003",
        observedAt: null,
      });

      const columns = await legacyDb.db.execute<{
        columnName: string;
        isNullable: string;
      }>(sql`
        select column_name as "columnName", is_nullable as "isNullable"
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'reservations'
          and column_name in ('slot_id', 'expert_id')
        order by column_name
      `);
      expect(columns.rows).toEqual([
        { columnName: "expert_id", isNullable: "NO" },
        { columnName: "slot_id", isNullable: "NO" },
      ]);
      const constraints = await legacyDb.db.execute<{
        constraintName: string;
      }>(sql`
        select constraint_name as "constraintName"
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'reservations'
          and constraint_name in (
            'reservations_slot_id_slots_id_fk',
            'reservations_expert_id_experts_id_fk'
          )
        order by constraint_name
      `);
      expect(constraints.rows.map((row) => row.constraintName)).toEqual([
        "reservations_expert_id_experts_id_fk",
        "reservations_slot_id_slots_id_fk",
      ]);
    } finally {
      await legacyDb.stop();
    }
  }, 120_000);

  it("deduplicates legacy dead letters before migration 0004 adds uniqueness", async () => {
    const legacyDb = await startTestPostgres();
    try {
      await applyLegacyBaseline(legacyDb.db);
      await applySqlMigration(
        legacyDb.db,
        "packages/db/migrations/0003_booking-concurrency.sql",
      );
      await legacyDb.db.execute(sql`
        insert into integration_outbox (
          id, idempotency_key, reconciliation_key, payload_hash
        ) values (
          '00000000-0000-4000-8000-000000000020'::uuid,
          'legacy:outbox',
          'legacy:reconciliation',
          'sha256:legacy'
        )
      `);
      await legacyDb.db.execute(sql`
        insert into dead_letters (
          id, outbox_id, reason, payload_hash, created_at, updated_at
        ) values
          (
            '00000000-0000-4000-8000-000000000021'::uuid,
            '00000000-0000-4000-8000-000000000020'::uuid,
            'canonical',
            'sha256:legacy',
            '2026-07-28T10:00:00.000Z',
            '2026-07-28T10:00:00.000Z'
          ),
          (
            '00000000-0000-4000-8000-000000000022'::uuid,
            '00000000-0000-4000-8000-000000000020'::uuid,
            'duplicate',
            'sha256:legacy',
            '2026-07-28T10:01:00.000Z',
            '2026-07-28T10:01:00.000Z'
          )
      `);

      await applySqlMigration(
        legacyDb.db,
        "packages/db/migrations/0004_durable_outbox.sql",
      );

      const rows = await legacyDb.db.execute<{ reason: string }>(sql`
        select reason
        from dead_letters
        where outbox_id = '00000000-0000-4000-8000-000000000020'::uuid
      `);
      expect(rows.rows).toEqual([{ reason: "canonical" }]);
      await expectDatabaseError(
        () =>
          legacyDb.db.execute(sql`
            insert into dead_letters (outbox_id, reason, payload_hash)
            values (
              '00000000-0000-4000-8000-000000000020'::uuid,
              'new-duplicate',
              'sha256:legacy'
            )
          `),
        { code: "23505", constraint: "dead_letters_outbox_unique" },
      );
    } finally {
      await legacyDb.stop();
    }
  }, 120_000);

  it("fails an ambiguous legacy slot mapping with an actionable migration error", async () => {
    const legacyDb = await startTestPostgres();
    try {
      await applyLegacyBaseline(legacyDb.db);
      await seedLegacyReservation(legacyDb.db, 2);

      let caught: unknown;
      try {
        await applySqlMigration(
          legacyDb.db,
          "packages/db/migrations/0003_booking-concurrency.sql",
        );
      } catch (error) {
        caught = error;
      }
      const chain = databaseErrorChain(caught);
      expect(
        chain.some(
          (error) =>
            error.code === "P0001" &&
            String(error.message).includes("booking_slot_backfill_ambiguous"),
        ),
      ).toBe(true);
    } finally {
      await legacyDb.stop();
    }
  }, 120_000);
});
