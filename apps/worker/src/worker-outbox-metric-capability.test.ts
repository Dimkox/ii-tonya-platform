import { describe, expect, it, vi } from "vitest";
import { LOCAL_OPERATOR_CASE_OUTBOX_TOPICS } from "../../../packages/contracts/src/worker-outbox.js";
import { composeWorkerOutboxDelivery } from "./main.js";

const registry = {
  topics: LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
  dispatch: vi.fn(),
  reconcile: vi.fn(),
};

describe("worker outbox metric capability", () => {
  it.each([null, {}, 1, "not-a-recorder"])(
    "rejects an incomplete recorder before repository construction",
    (metricRecorder) => {
      const transaction = vi.fn();
      expect(() =>
        composeWorkerOutboxDelivery(
          { transaction } as never,
          registry,
          metricRecorder as never,
        ),
      ).toThrow("worker_outbox_delivery_capability_unavailable");
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
