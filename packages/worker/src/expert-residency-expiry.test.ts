import { describe, expect, it, vi } from "vitest";
import { expireExpertResidencyOrders } from "./expert-residency-expiry.js";

describe("expert residency expiry job", () => {
  it("delegates exact-deadline expiry to the bounded repository transaction", async () => {
    const deadline = new Date("2026-09-02T00:00:00.000Z");
    const expireDueBatch = vi.fn(
      async (command: { readonly now: Date; readonly batchSize: number }) => {
        void command;
        return { examined: 1, changed: 1, creditChanged: 1, failed: 0 };
      },
    );

    await expect(
      expireExpertResidencyOrders({ expireDueBatch }, deadline, 100),
    ).resolves.toEqual({
      examined: 1,
      changed: 1,
      creditChanged: 1,
      failed: 0,
    });
    expect(expireDueBatch).toHaveBeenCalledWith({
      now: deadline,
      batchSize: 100,
    });
    expect(expireDueBatch.mock.calls[0]![0].now).not.toBe(deadline);
  });

  it.each([0, 1_001])(
    "rejects unsafe batch size %s before claiming",
    async (batchSize) => {
      const expireDueBatch = vi.fn();

      await expect(
        expireExpertResidencyOrders(
          { expireDueBatch },
          new Date("2026-09-02T00:00:00.000Z"),
          batchSize,
        ),
      ).rejects.toThrow("invalid_batch_size");
      expect(expireDueBatch).not.toHaveBeenCalled();
    },
  );
});
