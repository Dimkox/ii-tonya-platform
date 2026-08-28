import { describe, expect, it } from "vitest";
import { PostgresClientCommercialPolicyRepository } from "./client-commercial-policy-repository.js";

describe("PostgresClientCommercialPolicyRepository", () => {
  it("validates UUIDs before opening a transaction", async () => {
    const db = {
      transaction: () => {
        throw new Error("transaction opened");
      },
    } as never;
    await expect(
      new PostgresClientCommercialPolicyRepository(db).resolveOrAssign({
        userId: "bad",
        allowV2Admission: true,
      }),
    ).rejects.toThrow("INVALID_USER_ID");
  });
});
