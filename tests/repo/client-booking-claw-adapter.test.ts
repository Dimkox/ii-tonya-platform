import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("immutable client booking Claw adapter", () => {
  it("uses one literal manifest, a clean exact SHA and a credential-redacted package harness", () => {
    const runner = readFileSync("scripts/run-claw-ci.sh", "utf8");
    expect(runner).toContain("ci | database | release | client-booking");
    expect(runner).toContain("--untracked-files=all");
    expect(runner).toContain(
      "${II_TONYA_TEST_POSTGRES_ADMIN_URL:?II_TONYA_TEST_POSTGRES_ADMIN_URL is required}",
    );
    expect(runner).toContain("node scripts/assert-client-booking-postgres.mjs");
    expect(runner).toContain(
      "tests/integration/client-booking-schema.test.ts tests/repo/db-schema-parity.test.ts",
    );
    expect(runner).toContain(
      "packages/observability/src/metrics.test.ts tests/repo/workflow-semantics.test.ts --maxWorkers=1",
    );
    expect(runner).not.toMatch(/CLIENT_BOOKING_MANIFEST|BOOKING_TEST_FILES/u);
  });
});
