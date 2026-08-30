import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../packages/db/src/schema/index.js";

const names = (table: Parameters<typeof getTableConfig>[0]) => {
  const config = getTableConfig(table);
  return {
    checks: config.checks.map(({ name }) => name),
    indexes: config.indexes.map(({ config: index }) => index.name),
    uniques: config.uniqueConstraints.map(({ name }) => name),
  };
};

describe("test expert trial schema parity", () => {
  it("exports prompt, session, ledger, outcome, and audit authority with full named parity", () => {
    expect(schema).toHaveProperty("testExpertPromptAssets");
    expect(schema).toHaveProperty("testExpertCampaignVersions");
    expect(schema).toHaveProperty("testExpertSessions");
    expect(schema).toHaveProperty("testExpertDeterministicRequests");
    expect(schema).toHaveProperty("testExpertRedemptions");
    expect(schema).toHaveProperty("testExpertReservations");
    expect(schema).toHaveProperty("testExpertOutcomes");
    expect(schema).toHaveProperty("testExpertAuditEvents");
    expect(names(schema.testExpertCampaignVersions).checks).toEqual(
      expect.arrayContaining([
        "test_expert_campaign_cap_check",
        "test_expert_campaign_provider_calls_check",
        "test_expert_campaign_period_check",
        "test_expert_campaign_prompt_activation_check",
      ]),
    );
    expect(names(schema.testExpertPromptAssets).checks).toEqual(
      expect.arrayContaining([
        "test_expert_prompt_digest_check",
        "test_expert_prompt_status_check",
        "test_expert_prompt_activation_check",
      ]),
    );
    expect(names(schema.testExpertSessions).checks).toEqual(
      expect.arrayContaining([
        "test_expert_session_state_check",
        "test_expert_session_version_positive",
      ]),
    );
    expect(names(schema.testExpertDeterministicRequests).checks).toEqual(
      expect.arrayContaining([
        "test_expert_deterministic_bot_bounded",
        "test_expert_deterministic_key_bounded",
        "test_expert_deterministic_digest_check",
      ]),
    );
    expect(names(schema.testExpertRedemptions).checks).toEqual(
      expect.arrayContaining([
        "test_expert_redemption_nonnegative_check",
        "test_expert_redemption_capacity_check",
        "test_expert_redemption_granted_check",
        "test_expert_redemption_units_even_check",
      ]),
    );
    expect(names(schema.testExpertReservations).checks).toContain(
      "test_expert_reservation_units_check",
    );
    expect(names(schema.testExpertCampaignVersions).indexes).toContain(
      "test_expert_campaign_one_active_idx",
    );
    expect(names(schema.testExpertReservations).indexes).toContain(
      "test_expert_reservations_unknown_global_idx",
    );
    expect(names(schema.testExpertReservations).checks).toEqual(
      expect.arrayContaining([
        "test_expert_reservation_status_check",
        "test_expert_reservation_provider_request_check",
      ]),
    );
  });

  it("folds never-shipped hardening into 0038 with prompt FK, scans, and immutable audit", () => {
    const migration = readFileSync(
      "packages/db/migrations/0038_test_expert_trial.sql",
      "utf8",
    );
    expect(migration).toContain("cap_units integer not null default 100");
    expect(migration).toContain(
      "provider_calls_per_message integer not null default 1",
    );
    expect(migration).toContain("status text not null default 'inactive'");
    expect(migration).toContain(
      "consumed_units + reserved_units <= granted_units",
    );
    expect(migration).toContain("test_expert_prompt_assets");
    expect(migration).toContain("test_expert_sessions");
    expect(migration).toContain("test_expert_deterministic_requests");
    expect(migration).toContain("test_expert_deterministic_immutable");
    expect(migration).toContain("test_expert_campaign_prompt_asset_fk");
    expect(migration).toContain("test_expert_audit_immutable");
    expect(migration).toContain("test_expert_reservations_unknown_global_idx");
    expect(migration).toContain(
      "test_expert_reservations_provider_request_idx",
    );
    expect(migration).toContain("revoke all on test_expert_prompt_assets");
    expect(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ).not.toContain("0039_test_expert_trial_hardening");
  });
});
