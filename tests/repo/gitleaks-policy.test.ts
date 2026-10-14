import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EXPECTED_CONFIG = [
  "[extend]",
  "useDefault = true",
  "",
  "[[allowlists]]",
  'description = "Canonical non-secret placeholder tokens"',
  "regexes = ['''^__PLACEHOLDER_[A-Z0-9_]+__$''']",
  "",
  "[[allowlists]]",
  'description = "Versioned BMAD file checksum manifest"',
  "paths = ['''^_bmad/_config/files-manifest\\.csv$''']",
  "",
].join("\n");

const EXPECTED_HISTORICAL_FIXTURE_FINGERPRINTS = new Set([
  "07fc7c9561df1bb3e7ef1ecf8d9efbdf1823f2c4:tests/contract/telegram-port.test.ts:generic-api-key:456",
  "480efbf036c9033c1cde9883249d7041a27b2e32:docs/superpowers/plans/2026-07-28-ii-tonya-platform.md:generic-api-key:2546",
  "5f2a35a7c212b5c9d043665c0e50a6068d04e9c2:packages/integrations/src/projections/make-projection-sink.test.ts:generic-api-key:36",
  "c721fea39740188785b0004020453f96cfb31b59:docs/superpowers/plans/2026-07-28-ii-tonya-platform.md:generic-api-key:3179",
  "c721fea39740188785b0004020453f96cfb31b59:docs/superpowers/plans/2026-07-28-ii-tonya-platform.md:generic-api-key:3184",
  "c721fea39740188785b0004020453f96cfb31b59:docs/superpowers/plans/2026-07-28-ii-tonya-platform.md:generic-api-key:3199",
  "c721fea39740188785b0004020453f96cfb31b59:docs/superpowers/plans/2026-07-28-ii-tonya-platform.md:generic-api-key:3205",
  "ecf95979b3d00a2dca08d2e694aceb1c84e8f402:tests/contract/telegram-port.test.ts:generic-api-key:273",
  "ecf95979b3d00a2dca08d2e694aceb1c84e8f402:tests/contract/telegram-port.test.ts:generic-api-key:281",
  "ecf95979b3d00a2dca08d2e694aceb1c84e8f402:tests/contract/telegram-port.test.ts:generic-api-key:308",
  "ecf95979b3d00a2dca08d2e694aceb1c84e8f402:tests/contract/telegram-port.test.ts:generic-api-key:315",
  "ecf95979b3d00a2dca08d2e694aceb1c84e8f402:tests/contract/telegram-port.test.ts:generic-api-key:339",
  "ecf95979b3d00a2dca08d2e694aceb1c84e8f402:tests/contract/telegram-port.test.ts:generic-api-key:350",
  "43f838c45ff7546f4a243dc99f3b56c8871fed8b:tests/integration/test-expert-trial-postgres.test.ts:generic-api-key:40",
  "43f838c45ff7546f4a243dc99f3b56c8871fed8b:tests/integration/test-expert-trial-postgres.test.ts:generic-api-key:81",
  "ae4a2e2ce4bfd9e26dd2fe564c57ab5f2502f2bc:packages/config/src/hybrid-message-env.test.ts:generic-api-key:24",
  "e8874e2326645f7b0dcd4f1d0f395917f09ceff7:docs/spec/mvp-client-conversation-001.md:generic-api-key:118",
  "49daa26b35832c495978769283c36f62e5693878:docs/spec/mvp-client-conversation-001.md:generic-api-key:118",
  "141fd0229816723b137663816b2dc1773934f13f:docs/superpowers/architecture/architecture-mvp-client-booking-001/reviews/review-interface-security.md:generic-api-key:13",
  "27bc0fba98ce325ad00528205685cc1b8357fe04:docs/superpowers/architecture/architecture-mvp-client-booking-001/reviews/review-interface-security.md:generic-api-key:13",
  "75c964e7190fb92adcc8534f627c61405b338931:packages/integrations/src/yookassa/client.test.ts:generic-api-key:21",
  "75c964e7190fb92adcc8534f627c61405b338931:packages/integrations/src/yookassa/payment-adapter.test.ts:generic-api-key:465",
  "75c964e7190fb92adcc8534f627c61405b338931:packages/integrations/src/yookassa/payment-adapter.test.ts:generic-api-key:498",
  "cb6a66618d2443515240a326bf8ebdbb8c8157f7:packages/integrations/src/yookassa/payment-adapter.test.ts:generic-api-key:211",
  "cb6a66618d2443515240a326bf8ebdbb8c8157f7:packages/integrations/src/yookassa/payment-adapter.test.ts:generic-api-key:244",
  "b757f1db68aac4c8c2cf806ec821d599048455c3:packages/integrations/src/yookassa/payment-adapter.test.ts:generic-api-key:211",
  "b757f1db68aac4c8c2cf806ec821d599048455c3:packages/integrations/src/yookassa/payment-adapter.test.ts:generic-api-key:244",
  "db2eb47f8a1457b46bbba40ba208678574f49fc5:packages/integrations/src/yookassa/client.test.ts:generic-api-key:20",
  "0330264cbf96c193fd5319e44e174ab1f31b0478:tests/e2e/expert-residency-referral.test.ts:generic-api-key:251",
  "98af0496bc131026ac2705ed0c24042c9387260e:tests/e2e/expert-residency-referral.test.ts:generic-api-key:251",
  "ddb3509f0d338d4f89a8c834e2d738a955d319ae:apps/api/src/expert-telegram-command.test.ts:generic-api-key:80",
  "ddb3509f0d338d4f89a8c834e2d738a955d319ae:apps/api/src/expert-telegram-command.test.ts:generic-api-key:87",
  "ddb3509f0d338d4f89a8c834e2d738a955d319ae:apps/api/src/expert-telegram-command.test.ts:generic-api-key:247",
  "7d62ab1c3871028cd9c8d68a53794e4247951a02:apps/api/src/expert-telegram-command.test.ts:generic-api-key:80",
  "7d62ab1c3871028cd9c8d68a53794e4247951a02:apps/api/src/expert-telegram-command.test.ts:generic-api-key:87",
  "7d62ab1c3871028cd9c8d68a53794e4247951a02:apps/api/src/expert-telegram-command.test.ts:generic-api-key:247",
  "f75deacac8f927986d5c08ec0713e925ea27db51:apps/api/src/routes/expert-referral.test.ts:generic-api-key:222",
  "38cdd71ebffa1bd5978e34718829d470ff101ebb:apps/api/src/routes/expert-referral.test.ts:generic-api-key:222",
  "ae1e981780fe8c635c706326b9811f66b960e761:tests/test_grok_verification_adaptation.py:stripe-access-token:47",
  "ae1e981780fe8c635c706326b9811f66b960e761:tests/test_grok_verification_adaptation.py:generic-api-key:24",
  "125d5a100816d5a10b01fd64fba3cb62bc1bc801:tests/test_grok_verification_adaptation.py:generic-api-key:24",
  "125d5a100816d5a10b01fd64fba3cb62bc1bc801:tests/test_grok_verification_adaptation.py:stripe-access-token:47",
  "9e3e47e2dbe91e0f63d05fb51eab1b279c700a1a:packages/config/src/hybrid-message-env.test.ts:generic-api-key:24",
  "9e3e47e2dbe91e0f63d05fb51eab1b279c700a1a:tests/integration/test-expert-trial-postgres.test.ts:generic-api-key:41",
  "9e3e47e2dbe91e0f63d05fb51eab1b279c700a1a:tests/integration/test-expert-trial-postgres.test.ts:generic-api-key:84",
]);

describe("Gitleaks policy", () => {
  it("extends the default rules and permits only canonical placeholder tokens", () => {
    expect(readFileSync(".gitleaks.toml", "utf8").replace(/\r\n?/g, "\n")).toBe(
      EXPECTED_CONFIG,
    );

    const clawAdapter = readFileSync("scripts/run-claw-ci.sh", "utf8");
    expect(clawAdapter).toContain('git -C "$source_root" rev-parse HEAD');
    expect(clawAdapter).toContain(
      'git -C "$source_root" rev-list --objects --all --missing=print',
    );
    expect(clawAdapter).toContain(
      "Git history is incomplete; refusing security scan",
    );
    expect(clawAdapter).toContain("--config=/repo/.gitleaks.toml");
    expect(clawAdapter).toContain(
      "--gitleaks-ignore-path=/repo/.gitleaksignore",
    );
    expect(clawAdapter).toContain("--redact");
    expect(clawAdapter).toContain("--exit-code=1");
  });

  it("limits the BMAD scanner exception to its generated checksum manifest", () => {
    const config = readFileSync(".gitleaks.toml", "utf8");
    expect(config).toContain("^_bmad/_config/files-manifest\\.csv$");
    expect(config).not.toContain("_bmad/.*");
    expect(config).not.toContain(".agents/skills");
  });

  it("ignores only the reviewed historical fixture fingerprints", () => {
    const fingerprints = readFileSync(".gitleaksignore", "utf8")
      .split(/\r?\n/)
      .filter(Boolean);

    expect(new Set(fingerprints)).toEqual(
      EXPECTED_HISTORICAL_FIXTURE_FINGERPRINTS,
    );
    expect(fingerprints).toHaveLength(
      EXPECTED_HISTORICAL_FIXTURE_FINGERPRINTS.size,
    );
  });
});
