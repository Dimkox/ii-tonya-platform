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
]);

describe("Gitleaks policy", () => {
  it("extends the default rules and permits only canonical placeholder tokens", () => {
    expect(readFileSync(".gitleaks.toml", "utf8").replace(/\r\n?/g, "\n")).toBe(
      EXPECTED_CONFIG,
    );

    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("--config=/repo/.gitleaks.toml");
    expect(workflow).toContain("--gitleaks-ignore-path=/repo/.gitleaksignore");
    expect(workflow).toContain("--redact");
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
