import { describe, expect, it } from "vitest";
import { PostgresAdminRepository } from "../../packages/db/src/index.js";

describe("unregistered admin database workflows", () => {
  it("fails closed before a database handle can be used", async () => {
    const repository = new PostgresAdminRepository({} as never);
    await expect(repository.grantPackage({ userId: "not-a-user", units: 500, kind: "admin", expiresAt: null, idempotencyKey: "unregistered" })).rejects.toThrow("Admin workflows are not registered");
  });
});
