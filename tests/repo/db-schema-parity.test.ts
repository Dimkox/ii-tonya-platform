import { existsSync, readFileSync } from "node:fs";
import {
  getTableConfig,
  getViewConfig,
  PgDialect,
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
  clientProfiles,
  integrationInbox,
  integrationErrors,
  integrationOutbox,
  messageEvents,
  messageLedgerEntries,
  messagePackages,
  notifications,
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
  it("describes every named migration constraint and partial index", () => {
    expect(names(channelIdentities).uniques).toEqual([
      "channel_identities_provider_external_unique",
    ]);
    expect(names(clientProfiles).checks).toEqual([
      "client_profiles_expert_note_bounded",
    ]);
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
        "integration_outbox_reconciliation_key_present",
      ],
      indexes: [
        "integration_outbox_dispatch_lease",
        "integration_outbox_reconciliation_lease",
      ],
      uniques: ["integration_outbox_idempotency_unique"],
    });
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

  it("exports the reviewed expert-referral tables and derived balance view", () => {
    const exports = dbSchema as Record<string, unknown>;
    for (const name of [
      "expertReferralCodeBatches",
      "expertReferralCodes",
      "expertReferrals",
      "expertResidencyTariffVersions",
      "expertResidencyOrders",
      "expertResidencyPaymentAttempts",
      "expertResidencyProviderEventInbox",
      "expertFirstResidencySettlements",
      "expertReferralRewardGrants",
      "expertReferralLedgerEntries",
      "expertReferralLedgerAllocations",
      "expertReferralIssuanceOverrides",
      "expertReferralAbuseHolds",
      "expertReferralFeatureControls",
    ]) {
      expect(exports[name], name).toBeDefined();
    }
    expect(getViewConfig(exports.expertReferralBalances as PgView).name).toBe(
      "expert_referral_balances",
    );
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
    ];
    for (const name of requiredNames) expect(migration).toContain(name);
  });

  it("has a coherent latest Drizzle snapshot", () => {
    const path = "packages/db/migrations/meta/0015_snapshot.json";
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      tables?: Record<string, unknown>;
      views?: Record<string, unknown>;
    };
    expect(Object.keys(snapshot.tables ?? {})).toHaveLength(37);
    expect(snapshot.views).toHaveProperty("public.package_balances");
    const notificationsTable = snapshot.tables?.["public.notifications"] as
      | {
          foreignKeys?: Record<string, unknown>;
        }
      | undefined;
    expect(notificationsTable?.foreignKeys).toHaveProperty(
      "notifications_callback_expert_id_experts_id_fk",
    );
  });

  it("keeps the hardened residency migrations and generated snapshot in parity", () => {
    const path = "packages/db/migrations/meta/0021_snapshot.json";
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      id: string;
      prevId: string;
      tables: Record<
        string,
        {
          columns: Record<string, { type: string }>;
          indexes: Record<string, unknown>;
          foreignKeys: Record<string, unknown>;
          compositePrimaryKeys: Record<string, unknown>;
          uniqueConstraints: Record<string, unknown>;
          checkConstraints: Record<string, unknown>;
        }
      >;
      views: Record<
        string,
        {
          columns: Record<string, { type: string }>;
          definition: string;
        }
      >;
    };
    const migration = [
      "packages/db/migrations/0018_expert_residency_referrals.sql",
      "packages/db/migrations/0019_residency-checkout-request.sql",
      "packages/db/migrations/0020_fat_darkhawk.sql",
      "packages/db/migrations/0021_expert-residency-verification-evidence.sql",
    ]
      .map((migrationPath) => readFileSync(migrationPath, "utf8"))
      .join("\n");
    const reviewedTables = [
      "expertReferralCodeBatches",
      "expertReferralCodes",
      "expertReferrals",
      "expertResidencyTariffVersions",
      "expertResidencyOrders",
      "expertResidencyPaymentAttempts",
      "expertResidencyProviderEventInbox",
      "expertFirstResidencySettlements",
      "expertReferralRewardGrants",
      "expertReferralLedgerEntries",
      "expertReferralLedgerAllocations",
      "expertReferralIssuanceOverrides",
      "expertReferralAbuseHolds",
      "expertReferralFeatureControls",
    ] as const;
    expect(reviewedTables).toHaveLength(14);

    for (const exportName of reviewedTables) {
      const table = dbSchema[exportName] as AnyPgTable;
      const config = getTableConfig(table);
      const generated = snapshot.tables[`public.${config.name}`];
      expect(generated, exportName).toBeDefined();
      if (generated === undefined) continue;

      expect(
        Object.keys(generated.columns).sort(),
        `${exportName} columns`,
      ).toEqual(config.columns.map(({ name }) => name).sort());
      for (const column of config.columns) {
        expect(
          generated.columns[column.name]?.type,
          `${exportName}.${column.name}`,
        ).toBe(column.getSQLType());
      }

      const expectedMetadataNames = {
        checks: config.checks.map(({ name }) => name).sort(),
        foreignKeys: config.foreignKeys
          .map((foreignKey) => foreignKey.getName())
          .sort(),
        indexes: config.indexes.map(({ config: index }) => index.name).sort(),
        primaryKeys: config.primaryKeys
          .map((primaryKey) => primaryKey.getName())
          .sort(),
        uniques: config.uniqueConstraints.map(({ name }) => name).sort(),
      };
      expect(Object.keys(generated.checkConstraints).sort()).toEqual(
        expectedMetadataNames.checks,
      );
      expect(Object.keys(generated.foreignKeys).sort()).toEqual(
        expectedMetadataNames.foreignKeys,
      );
      expect(Object.keys(generated.indexes).sort()).toEqual(
        expectedMetadataNames.indexes,
      );
      expect(Object.keys(generated.compositePrimaryKeys).sort()).toEqual(
        expectedMetadataNames.primaryKeys,
      );
      expect(Object.keys(generated.uniqueConstraints).sort()).toEqual(
        expectedMetadataNames.uniques,
      );
      for (const name of Object.values(expectedMetadataNames).flat()) {
        expect(migration, `${exportName}: ${name}`).toContain(name);
      }
    }

    const viewConfig = getViewConfig(dbSchema.expertReferralBalances as PgView);
    const generatedView = snapshot.views["public.expert_referral_balances"];
    expect(generatedView).toBeDefined();
    expect(viewConfig.query).toBeDefined();
    if (generatedView === undefined || viewConfig.query === undefined) return;
    expect(Object.keys(generatedView.columns).sort()).toEqual(
      (Object.values(viewConfig.selectedFields) as Array<{ name: string }>)
        .map((field) => field.name)
        .sort(),
    );
    expect(generatedView.definition.trim()).toBe(
      new PgDialect().sqlToQuery(viewConfig.query).sql.trim(),
    );

    const previousSnapshot = JSON.parse(
      readFileSync("packages/db/migrations/meta/0020_snapshot.json", "utf8"),
    ) as { id: string };
    expect(snapshot.prevId).toBe(previousSnapshot.id);
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 21,
      tag: "0021_expert-residency-verification-evidence",
    });
    expect(journal.entries.filter(({ idx }) => idx === 19)).toHaveLength(1);
    expect(journal.entries.filter(({ idx }) => idx === 20)).toHaveLength(1);
    expect(journal.entries.filter(({ idx }) => idx === 21)).toHaveLength(1);

    for (const hardenedName of [
      "experts_user_id_unique",
      "expert_tariff_active_interval_exclusion",
      "expert_first_settlement_order_eligible",
      "expert_reward_ledger_exact",
      "expert_ledger_terminal_match",
      "expert_ledger_allocation_required",
      "expert_order_provider_deadline_after_quote",
      "expert_order_provider_deadline_required",
      "expert_residency_payment_deadline_state",
      "verification_id",
      "verifier_key_version",
      "verified_at",
    ]) {
      expect(migration, hardenedName).toContain(hardenedName);
    }
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
