import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEST_EXPERT_TRIAL_METRICS } from "../../packages/application/src/test-expert-trial-metrics.js";

describe("test expert trial traceability", () => {
  it("publishes the inactive source manifest with the authoritative digest", () => {
    const manifest = JSON.parse(
      readFileSync("docs/prompts/test-expert-source-manifest.json", "utf8"),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      key: "expert.functional",
      version: 1,
      sha256:
        "0439ae1c645e6fda46f013a66512401f251aa18d35520f5c9a7a3c7c59314eaf",
      sourcePath: "docs/source/ii-tonya-expert-full-source-2026-07-28.txt",
      status: "inactive",
    });
    expect(manifest.activationRequirements).toEqual(
      expect.arrayContaining([
        "approved_prompt_copy",
        "official_selarti_contract",
        "provider_activation_gate",
      ]),
    );
  });
  it("keeps four flags, migration, metric names, and analytics preservation traceable", () => {
    const env = readFileSync("packages/config/src/env.ts", "utf8");
    expect(env).toMatch(
      /TEST_EXPERT_(?:PROMO|DETERMINISTIC_FLOW|SELARTI)_ENABLED/gu,
    );
    expect(env).toContain("TEST_EXPERT_PROMPT_VERSION");
    expect(
      readFileSync("packages/db/migrations/0038_test_expert_trial.sql", "utf8"),
    ).toContain("test_expert_campaign_versions");
    const trialMigration = readFileSync(
      "packages/db/migrations/0038_test_expert_trial.sql",
      "utf8",
    );
    expect(trialMigration).toContain("test_expert_campaign_one_active_idx");
    expect(trialMigration).toContain(
      "test_expert_reservations_unknown_global_idx",
    );
    expect(trialMigration).toContain("official_contract_evidence");
    expect(TEST_EXPERT_TRIAL_METRICS).toEqual([
      "redemption_created",
      "deterministic_message",
      "units_reserved",
      "units_consumed",
      "units_released",
      "unknown_outcome",
      "cap_rejected",
      "duplicate_request",
      "provider_outcome",
      "reconciliation_age",
      "conversion",
      "cost_per_trial",
      "deterministic_offload",
    ]);
    expect(readFileSync("apps/web/index.html", "utf8")).toContain(
      "mc.yandex.ru/metrika/tag.js?id=111827123",
    );
  });

  it("keeps raw trial text ephemeral under the existing retention boundary", () => {
    const retention = readFileSync("docs/operations/data-retention.md", "utf8");
    const repository = readFileSync(
      "packages/db/src/repositories/test-expert-trial-repository.ts",
      "utf8",
    );
    expect(retention).toContain("raw text is never stored");
    expect(repository).not.toMatch(/raw_(?:message|response|body)/u);
    expect(repository).not.toMatch(/message_text/u);
  });
});
