import { readFileSync } from "node:fs";
import { getTableConfig, type AnyPgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../packages/db/src/schema/index.js";

const names = (table: AnyPgTable) => {
  const config = getTableConfig(table);
  return { checks: config.checks.map(({ name }) => name).sort(), foreignKeys: config.foreignKeys.map((key) => key.getName()).sort(), indexes: config.indexes.map(({ config: index }) => index.name).sort(), uniques: config.uniqueConstraints.map(({ name }) => name).sort() };
};

describe("partner commerce schema parity", () => {
  it("exports all foundation relations", () => {
    for (const name of ["commercialParticipants", "organizationProfiles", "partnerTariffPolicyVersions", "partnerShadowQuotes", "partnerCommandReceipts"]) expect(schema, name).toHaveProperty(name);
  });
  it("describes required constraints and indexes", () => {
    expect(names(schema.commercialParticipants)).toMatchObject({ checks: expect.arrayContaining(["commercial_participants_kind_check", "commercial_participants_onboarding_state_check", "commercial_participants_state_kind_coherence_check"]), uniques: ["commercial_participants_id_kind_unique", "commercial_participants_user_kind_unique"] });
    expect(names(schema.commercialParticipants).checks).toContain("commercial_participants_state_kind_coherence_check");
    expect(names(schema.commercialParticipants).indexes).toContain("commercial_participants_pending_user_unique");
    expect(names(schema.organizationProfiles).checks).toEqual(["organization_profiles_city_check", "organization_profiles_kind_check", "organization_profiles_legal_name_check", "organization_profiles_verification_check"]);
    expect(names(schema.partnerTariffPolicyVersions).checks).toEqual(expect.arrayContaining(["partner_tariff_policy_versions_currency_check", "partner_tariff_policy_versions_entitlements_check", "partner_tariff_policy_versions_money_check", "partner_tariff_policy_versions_window_check"]));
    expect(names(schema.partnerTariffPolicyVersions).indexes).toContain("partner_tariff_policy_versions_active_idx");
    expect(names(schema.partnerShadowQuotes).checks).toEqual(expect.arrayContaining(["partner_shadow_quotes_arithmetic_check", "partner_shadow_quotes_currency_check", "partner_shadow_quotes_money_check", "partner_shadow_quotes_entitlements_check"]));
    expect(names(schema.partnerShadowQuotes).foreignKeys).toEqual(expect.arrayContaining(["partner_shadow_quotes_participant_kind_fk", "partner_shadow_quotes_policy_kind_fk"]));
  });
  it("keeps policy and quote predicates semantically exact", () => {
    const migration = readFileSync("packages/db/migrations/0037_partner_commerce_a.sql", "utf8");
    const drizzle = readFileSync("packages/db/src/schema/partner-commerce.ts", "utf8");
    for (const predicate of ["online_only_surcharge_minor=300000", "city_million_plus_surcharge_minor=500000", "resident_commission_bps=1000", "nonresident_commission_bps=1500", "nonresident_card_fee_minor=450000", `event_entitlements='{"bands":[{"capacity":30,"count":10}]}'::jsonb`, `event_entitlements='{"bands":[{"capacity":50,"count":5},{"capacity":100,"count":3},{"capacity":500,"count":1}]}'::jsonb`]) expect(migration).toContain(predicate);
    expect(migration).toContain("CONSTRAINT partner_shadow_quotes_count_check CHECK (qualified_expert_count >= 0)");
    expect(migration).toContain("CONSTRAINT partner_shadow_quotes_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES commercial_participants(id)");
    expect(migration).toContain("CONSTRAINT partner_shadow_quotes_policy_id_fkey FOREIGN KEY (policy_id) REFERENCES partner_tariff_policy_versions(id)");
    expect(migration).toContain("CONSTRAINT partner_shadow_quotes_participant_kind_fk FOREIGN KEY (participant_id, partner_kind) REFERENCES commercial_participants(id, participant_kind)");
    expect(migration).toContain("CONSTRAINT partner_shadow_quotes_policy_kind_fk FOREIGN KEY (policy_version_id, partner_kind) REFERENCES partner_tariff_policy_versions(policy_version_id, partner_kind)");
    for (const predicate of ["qualifiedExpertCount} >= 0", "residentCommissionBps}=1000", "nonresidentCommissionBps}=1500", "nonresidentCardFeeMinor}=450000", "partner_shadow_quotes_entitlements_check"]) expect(drizzle).toContain(predicate);
    expect(drizzle).not.toContain('check("partner_shadow_quotes_entitlements_check", sql`true`)');
    expect(names(schema.partnerShadowQuotes).foreignKeys).toEqual(expect.arrayContaining([
      "partner_shadow_quotes_participant_id_commercial_participants_id_fk", "partner_shadow_quotes_policy_id_partner_tariff_policy_versions_id_fk", "partner_shadow_quotes_participant_kind_fk", "partner_shadow_quotes_policy_kind_fk",
    ]));
  });
});
