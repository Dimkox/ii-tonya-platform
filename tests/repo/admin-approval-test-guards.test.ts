import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin approval PostgreSQL fixtures", () => {
  it("parameterizes MFA offsets instead of composing SQL fragments", () => {
    const source = readFileSync(
      "tests/integration/admin-approval.test.ts",
      "utf8",
    );
    expect(source).not.toContain("sql.raw(mfaOffset)");
    expect(source).toContain(
      "clock_timestamp() + (${mfaOffsetMinutes} * interval '1 minute')",
    );
  });
});
