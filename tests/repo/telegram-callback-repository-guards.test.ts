import { describe, expect, it, vi } from "vitest";
import {
  PostgresTelegramCallbackRepository,
  type DrizzleDb,
} from "../../packages/db/src/index.js";

describe("PostgresTelegramCallbackRepository infrastructure failures", () => {
  it("wraps a database outage as a typed retryable infrastructure error", async () => {
    const databaseFailure = new Error("database connection refused");
    const db = {
      $client: {
        query: vi.fn(async () => {
          throw databaseFailure;
        }),
      },
    } as unknown as DrizzleDb;
    const repository = new PostgresTelegramCallbackRepository(db);

    const rejection = repository.peek("opaque-token-hash");
    await expect(rejection).rejects.toMatchObject({
      name: "CallbackInfrastructureError",
      code: "callback_store_unavailable",
      retryable: true,
      cause: databaseFailure,
    });
  });
});
