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

    const assertion = readFileSync(
      "scripts/assert-client-booking-postgres.mjs",
      "utf8",
    );
    expect(assertion).toContain('version !== "160015"');
    expect(assertion).toContain("client_booking_postgres_version=160015");
    expect(assertion).not.toMatch(/console\.log\([^)]*(?:URL|connection)/iu);

    for (const documentPath of [
      "docs/spec/mvp-client-booking-001.md",
      "docs/spec/mvp-client-booking-001-traceability.md",
      "docs/superpowers/plans/2026-08-14-mvp-client-booking-001.md",
      "docs/runbooks/client-booking-activation.md",
      "docs/superpowers/architecture/architecture-mvp-client-booking-001/ARCHITECTURE-SPINE.md",
      "docs/superpowers/architecture/architecture-mvp-client-booking-001/.memlog.md",
      "_bmad-output/specs/spec-mvp-client-booking-001/SPEC.md",
      "_bmad-output/specs/spec-mvp-client-booking-001/.memlog.md",
    ]) {
      const document = readFileSync(documentPath, "utf8");
      expect(document).toMatch(/PostgreSQL\s+16\.0\.15/u);
      expect(document).not.toContain("170005");
    }

    const progress = readFileSync("docs/spec/mvp-client-booking-001-progress.md", "utf8");
    expect(progress).toContain("160015");
    expect(progress).toContain("not a Claw gate result");
  });
});
