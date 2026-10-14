import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = "packages/db/migrations";
const META = `${MIGRATIONS}/meta`;
const SCHEMA_DIR = "packages/db/src/schema";

type JournalEntry = {
  idx: number;
  version: string;
  tag: string;
  breakpoints: boolean;
};

const snapshotPath = (idx: number): string =>
  `${META}/${String(idx).padStart(4, "0")}_snapshot.json`;

// Migration history is hand-authored: these entries have SQL but no Drizzle
// snapshot. The database-derived 0039 baseline closes only the latest gap;
// schema-derived generate remains prohibited. The list is a frozen
// baseline - a NEW gap fails the guard, closing one only requires shrinking it.
const MISSING_SNAPSHOT_BASELINE = [
  14, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
  38,
];

// drizzle-kit 0.31.x aborts JSON.stringify on a BigInt schema default, so
// `generate` is unusable while these exist. Pinned to make a new one loud.
const BIGINT_LITERAL_DEFAULTS_BASELINE = [
  "packages/db/src/schema/integration.ts:next_delivery_sequence",
];

// Objects that exist only in hand-authored SQL. drizzle-kit cannot emit them, so a
// schema-derived snapshot - and therefore `generate` - cannot reproduce the real
// database: a full generate already fails on `expert_jsonb_has_exact_keys`.
// Adding a new one is legitimate, but it must be listed here so the author sees that
// the migration tool cannot produce it.
const HAND_SQL_FUNCTIONS = [
  "audit_test_expert_lifecycle_transition",
  "booking_notification_attempt_state_valid",
  "booking_notification_context_immutable",
  "booking_notification_delivery_immutable",
  "booking_notification_fact_immutable",
  "client_booking_guard_privacy_completion",
  "client_commercial_policy_assignment_immutable",
  "enforce_admin_ledger_provenance",
  "enforce_admin_package_provenance",
  "enforce_client_coupon_purchase",
  "enforce_client_paid_settlement",
  "enforce_expert_campaign_order_source",
  "enforce_expert_campaign_quote_source",
  "enforce_expert_referral_admin_approval_global_unique",
  "enforce_human_escalation_transition",
  "expert_first_settlement_guard_change",
  "expert_jsonb_has_exact_keys",
  "expert_provider_reversal_result_guard",
  "expert_referral_maturities_append_only_terminal",
  "expert_referral_maturities_no_delete",
  "expert_referral_validate_ledger_allocation_total",
  "expert_residency_default_provider_deadline",
  "expert_reward_grant_require_eligible_settlement",
  "lock_and_reject_selarti_budget_policy_overlap",
  "lock_partner_policy_window",
  "planerka_availability_mapping_invalidate",
  "planerka_operation_guard",
  "planerka_privacy_completion",
  "planerka_reservation_transition",
  "protect_expert_campaign_order_snapshot",
  "reject_append_only_change",
  "reject_expert_referral_admin_result_mutation",
  "reject_partner_commerce_mutation",
  "reject_selarti_budget_policy_mutation",
  "reject_test_expert_immutable_mutation",
  "validate_and_consume_selarti_budget_approval",
  "validate_test_expert_campaign_prompt",
  "validate_test_expert_campaign_transition",
  "validate_test_expert_initial_status",
  "validate_test_expert_prompt_transition",
] as const;

const HAND_SQL_TRIGGERS = [
  "audit_events_append_only",
  "booking_handoff_revocation_receipts_append_only",
  "booking_notification_attempt_delivery_state",
  "booking_notification_attempt_immutable",
  "booking_notification_context_immutable",
  "booking_notification_delivery_attempt_state",
  "booking_notification_delivery_immutable",
  "booking_notification_fact_delivery_state",
  "booking_notification_fact_immutable",
  "client_booking_privacy_completion_guard",
  "client_commercial_policy_assignments_no_delete",
  "client_commercial_policy_assignments_no_update",
  "client_coupon_grants_immutable",
  "client_coupon_grants_purchase",
  "client_paid_bindings_immutable",
  "client_paid_orders_immutable",
  "client_paid_settlements_immutable",
  "client_paid_settlements_integrity",
  "consent_document_versions_append_only",
  "consents_append_only",
  "delivery_attempts_append_only",
  "expert_campaign_anchors_append_only",
  "expert_campaign_order_snapshot_immutable",
  "expert_campaign_order_source",
  "expert_campaign_quote_source",
  "expert_campaign_quotes_append_only",
  "expert_referral_admin_approval_global_unique",
  "expert_referral_admin_results_immutable",
  "expert_referral_admin_results_truncate_immutable",
  "expert_referral_maturities_delete_guard",
  "expert_referral_maturities_terminal_guard",
  "human_escalations_append_only",
  "message_ledger_entries_append_only",
  "message_packages_append_only",
  "partner_shadow_quotes_immutable",
  "partner_tariff_policy_versions_immutable",
  "partner_tariff_policy_versions_no_overlap",
  "planerka_availability_mapping_invalidation",
  "planerka_operation_identity_guard",
  "planerka_privacy_completion_guard",
  "planerka_reservation_transition_guard",
  "prompt_versions_append_only",
  "reconciliation_mismatches_append_only",
  "safety_incidents_append_only",
  "selarti_budget_policy_approval",
  "selarti_budget_policy_immutable",
  "selarti_budget_policy_no_overlap",
  "test_expert_audit_immutable",
  "test_expert_campaign_initial_status",
  "test_expert_campaign_prompt_authority",
  "test_expert_campaign_transition",
  "test_expert_campaign_transition_audit",
  "test_expert_deterministic_immutable",
  "test_expert_lifecycle_audit_immutable",
  "test_expert_prompt_initial_status",
  "test_expert_prompt_transition",
  "test_expert_prompt_transition_audit",
] as const;

const HAND_SQL_VIEWS = ["package_balances"] as const;

const HAND_SQL_EXTENSIONS = ["btree_gist", "pgcrypto"] as const;

describe("migration history integrity", () => {
  const journal = JSON.parse(readFileSync(`${META}/_journal.json`, "utf8")) as {
    entries: JournalEntry[];
  };
  const sqlNames = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4))
    .sort();

  it("keeps journal entries contiguous and ordered", () => {
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_entry, position) => position),
    );
    expect(
      journal.entries.filter(
        (entry) => entry.version !== journal.entries[0]?.version,
      ).length,
    ).toBe(0);
  });

  it("keeps every journal entry and migration file paired", () => {
    const tags = journal.entries.map((entry) => entry.tag).sort();
    expect(tags).toEqual(sqlNames);
    expect(
      journal.entries.filter(
        (entry) =>
          !entry.tag.startsWith(`${String(entry.idx).padStart(4, "0")}_`),
      ),
    ).toEqual([]);
  });

  it("keeps snapshot gaps inside the frozen hand-authored baseline", () => {
    const missing = journal.entries
      .filter((entry) => !existsSync(snapshotPath(entry.idx)))
      .map((entry) => entry.idx);
    // A new migration without a snapshot must never slip in silently.
    expect(
      missing.filter((idx) => !MISSING_SNAPSHOT_BASELINE.includes(idx)),
    ).toEqual([]);
    // Closing a gap is welcome - then shrink the baseline in the same change.
    expect(
      MISSING_SNAPSHOT_BASELINE.filter((idx) => !missing.includes(idx)),
    ).toEqual([]);
  });

  it("pins the newest snapshot as the drizzle-kit generate diff base", () => {
    const newest = Math.max(
      ...journal.entries
        .filter((entry) => existsSync(snapshotPath(entry.idx)))
        .map((entry) => entry.idx),
    );
    expect(newest).toBe(51);
    expect(newest).toBeLessThanOrEqual(
      Math.max(...journal.entries.map((entry) => entry.idx)),
    );
  });

  it("pins bigint defaults that break drizzle-kit generate", () => {
    const found: string[] = [];
    for (const name of readdirSync("packages/db/src/schema")) {
      if (!name.endsWith(".ts")) {
        continue;
      }
      const path = `packages/db/src/schema/${name}`;
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(
        /bigint\(\s*"([^"]+)"[\s\S]{0,160}?\.default\(\s*(?:0|[1-9][0-9]*)n\s*\)/g,
      )) {
        found.push(`${path}:${match[1]}`);
      }
    }
    expect(found.sort()).toEqual(BIGINT_LITERAL_DEFAULTS_BASELINE);
  });

  it("keeps the hand-authored migration policy documented", () => {
    const contract = readFileSync("AGENTS.md", "utf8");
    expect(contract).toContain("## Migration history is hand-authored");
    expect(contract).toContain("drizzle-kit generate");
    expect(contract).toContain("0021");
    expect(contract).toContain("Everything's fine");
  });
  it("pins the SQL objects that drizzle-kit cannot reproduce", () => {
    const sources = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(`${MIGRATIONS}/${name}`, "utf8"))
      .join("\n");
    const collect = (pattern: RegExp): string[] =>
      [
        ...new Set(
          [...sources.matchAll(pattern)]
            .map((match) => match[1])
            .filter((name): name is string => name !== undefined),
        ),
      ].sort();

    expect(
      collect(/create\s+(?:or replace\s+)?function\s+([a-z_]+)/gi),
    ).toEqual([...HAND_SQL_FUNCTIONS]);
    expect(collect(/create\s+(?:constraint\s+)?trigger\s+([a-z_]+)/gi)).toEqual(
      [...HAND_SQL_TRIGGERS],
    );
    expect(collect(/create\s+(?:or replace\s+)?view\s+([a-z_.]+)/gi)).toEqual([
      ...HAND_SQL_VIEWS,
    ]);
    expect(
      collect(/create\s+extension\s+(?:if not exists\s+)?([a-z_]+)/gi),
    ).toEqual([...HAND_SQL_EXTENSIONS]);
  });
  it("keeps declared tables and migrated tables identical", () => {
    const schemaFiles = readdirSync(SCHEMA_DIR).filter((name) =>
      name.endsWith(".ts"),
    );
    const declared = new Set<string>();
    for (const name of schemaFiles) {
      const source = readFileSync(`${SCHEMA_DIR}/${name}`, "utf8");
      for (const match of source.matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)) {
        declared.add(match[1] as string);
      }
      for (const match of source.matchAll(
        /pgTable\(\s*\{\s*schema:\s*"[a-z_]+",\s*name:\s*"([a-z0-9_]+)"/g,
      )) {
        declared.add(match[1] as string);
      }
    }

    const migrated = new Set<string>();
    for (const name of readdirSync(MIGRATIONS).filter((file) =>
      file.endsWith(".sql"),
    )) {
      const source = readFileSync(`${MIGRATIONS}/${name}`, "utf8");
      for (const match of source.matchAll(
        /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi,
      )) {
        migrated.add(match[1] as string);
      }
    }

    const onlyDeclared = [...declared].filter((table) => !migrated.has(table));
    const onlyMigrated = [...migrated].filter((table) => !declared.has(table));
    expect(
      { tables: declared.size, onlyDeclared, onlyMigrated },
      "every pgTable must be created by a migration and every migrated table must be declared",
    ).toEqual({ tables: migrated.size, onlyDeclared: [], onlyMigrated: [] });
    // 0051 adds the durable, fenced availability refresh state.
    expect(declared.size).toBe(123);
  });
});
