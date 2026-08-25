import { describe, expect, it } from "vitest";
import { withSerializableRetry } from "../../packages/db/src/index.js";

describe("serializable retry", () => {
  it("retries a nested SQLSTATE 40001 only up to its bound", async () => {
    let calls = 0;
    await expect(
      withSerializableRetry(async () => {
        calls += 1;
        throw { cause: { code: "40001" } };
      }, 2),
    ).rejects.toMatchObject({ cause: { code: "40001" } });
    expect(calls).toBe(2);
  });

  it("propagates non-retryable database errors without a second attempt", async () => {
    let calls = 0;
    const error = { code: "23505" };
    await expect(
      withSerializableRetry(async () => {
        calls += 1;
        throw error;
      }),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it("retries a nested PostgreSQL deadlock SQLSTATE 40P01", async () => {
    let calls = 0;
    await expect(
      withSerializableRetry(async () => {
        calls += 1;
        if (calls === 1) throw { cause: { code: "40P01" } };
        return "recovered";
      }),
    ).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });
});
