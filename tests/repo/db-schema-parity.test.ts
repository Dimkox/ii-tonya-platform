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
  channelIdentities,
  integrationInbox,
  integrationOutbox,
  messageEvents,
  messageLedgerEntries,
  messagePackages,
  notifications,
  privacyDeletionJobs,
  privacyProcessorAttempts,
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
    expect(names(slots)).toMatchObject({
      checks: ["slots_capacity_positive"],
      uniques: ["slots_provider_external_unique"],
    });
    expect(names(messagePackages)).toMatchObject({
      checks: [
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
      checks: ["message_ledger_delta_matches_kind"],
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
    expect(names(adminApprovals).uniques).toEqual([
      "admin_approvals_scope_nonce_unique",
    ]);
    expect(names(privacyDeletionJobs).uniques).toEqual([
      "privacy_deletion_jobs_subject_idempotency_unique",
    ]);
    expect(names(privacyProcessorAttempts).uniques).toEqual([
      "privacy_processor_attempts_job_processor_unique",
    ]);
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
      "admin_approvals_scope_nonce_unique",
      "privacy_deletion_jobs_subject_idempotency_unique",
      "privacy_processor_attempts_job_processor_unique",
      "provider_cursors_provider_unique",
      "projection_checkpoints_projection_unique",
      "integration_inbox_message_event_id_message_events_id_fk",
    ];
    for (const name of requiredNames) expect(migration).toContain(name);
  });

  it("has a coherent latest Drizzle snapshot", () => {
    const path = "packages/db/migrations/meta/0004_snapshot.json";
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      tables?: Record<string, unknown>;
      views?: Record<string, unknown>;
    };
    expect(Object.keys(snapshot.tables ?? {})).toHaveLength(31);
    expect(snapshot.views).toHaveProperty("public.package_balances");
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
