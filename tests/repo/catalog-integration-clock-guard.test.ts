import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const catalogIntegration = readFileSync(
  "tests/integration/catalog-repository.test.ts",
  "utf8",
);

describe("catalog integration clock guard", () => {
  it("derives reservation expiry from the database clock", () => {
    const reservationInsert = catalogIntegration.slice(
      catalogIntegration.indexOf("insert into reservations"),
      catalogIntegration.indexOf("const result ="),
    );

    expect(reservationInsert).toContain("clock_timestamp() + interval '1 hour'");
    expect(reservationInsert).not.toContain("new Date(");
  });
});
