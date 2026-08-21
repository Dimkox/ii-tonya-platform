import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("MVP client catalog storage boundaries", () => {
  it("allocates migration 0029 without weakening the prerequisite registry", () => {
    expect(read("packages/db/migrations/meta/_journal.json")).toContain(
      '"tag": "0029_client_catalog_requests"',
    );
    expect(read("packages/contracts/src/worker-outbox.ts")).toContain(
      '"safety.operator_escalation",\n  "admin.negative_feedback",',
    );
    expect(read("packages/contracts/src/worker-outbox.ts")).toContain(
      "catalog.show",
    );
  });

  it("stores only bounded public snapshot fields", () => {
    const migration = read(
      "packages/db/migrations/0029_client_catalog_requests.sql",
    );
    const repository = read(
      "packages/db/src/repositories/client-catalog-repository.ts",
    );

    expect(migration).toContain("jsonb_array_length");
    expect(migration).toContain("<= 20");
    expect(repository).not.toMatch(
      /providerId|expertId|serviceId|slotId|contact|email|phone|rawPayload/u,
    );
  });
});
