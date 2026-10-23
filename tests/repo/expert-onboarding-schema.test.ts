import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../packages/db/src/schema/index.js";

describe("expert onboarding schema metadata", () => {
  it("exports the applicant boundary with database ownership and a pending queue index", () => {
    expect(schema).toHaveProperty("expertOnboardingApplications");
    const table = (schema as Record<string, unknown>)
      .expertOnboardingApplications;
    if (!table) return;
    const config = getTableConfig(
      table as Parameters<typeof getTableConfig>[0],
    );
    expect(config.name).toBe("expert_onboarding_applications");
    expect(config.columns.map((c) => c.name).sort()).toEqual(
      [
        "id",
        "user_id",
        "campaign_quote_id",
        "verification_status",
        "onboarding_stage",
        "created_at",
        "updated_at",
        "archived_at",
        "archive_until_date",
      ].sort(),
    );
    expect(config.uniqueConstraints.map((c) => c.name)).toContain(
      "expert_onboarding_user_unique",
    );
    expect(config.foreignKeys.map((c) => c.getName())).toContain(
      "expert_onboarding_quote_owner_fk",
    );
    const quote = config.foreignKeys
      .find((c) => c.getName() === "expert_onboarding_quote_owner_fk")!
      .reference();
    expect(quote.columns.map((c) => c.name)).toEqual([
      "campaign_quote_id",
      "user_id",
    ]);
    expect(quote.foreignColumns.map((c) => c.name)).toEqual(["id", "user_id"]);
    const queue = config.indexes.find(
      (i) => i.config.name === "expert_onboarding_pending_queue_idx",
    )!;
    expect(
      queue.config.columns.map((c) => ("name" in c ? c.name : null)),
    ).toEqual(["created_at", "id"]);
    expect(new PgDialect().sqlToQuery(queue.config.where!).sql).toContain(
      "verification_status = 'pending'",
    );
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      "expert_onboarding_archive_bounds",
      "expert_onboarding_stage_valid",
      "expert_onboarding_verification_valid",
    ]);
  });
});
