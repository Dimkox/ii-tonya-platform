import { describe, expect, it, vi } from "vitest";
import { LOCAL_OPERATOR_CASE_OUTBOX_TOPICS } from "@ii-tonya/contracts";
import { LOCAL_OPERATOR_CASE_OUTBOX_TOPICS as registryTopics } from "../../../packages/worker/src/local-operator-case-outbox.js";
import {
  composeWorkerOutboxDelivery,
  selectWorkerOutboxRegistry,
} from "./main.js";

const enabled = {
  features: { workerOutboxDelivery: true },
} as never;

describe("review-remediated worker outbox composition", () => {
  it("derives both consumers from the same frozen ordered tuple", () => {
    expect(registryTopics).toBe(LOCAL_OPERATOR_CASE_OUTBOX_TOPICS);
    expect(registryTopics).toEqual([
      "safety.operator_escalation",
      "admin.negative_feedback",
    ]);
    expect(Object.isFrozen(registryTopics)).toBe(true);
  });

  it.each([
    null,
    {},
    { topics: LOCAL_OPERATOR_CASE_OUTBOX_TOPICS },
    { topics: LOCAL_OPERATOR_CASE_OUTBOX_TOPICS, dispatch: vi.fn() },
    { topics: LOCAL_OPERATOR_CASE_OUTBOX_TOPICS, reconcile: vi.fn() },
    {
      topics: ["admin.negative_feedback", "safety.operator_escalation"],
      dispatch: vi.fn(),
      reconcile: vi.fn(),
    },
  ])("rejects incomplete enabled capability before repository use", (value) => {
    expect(() =>
      selectWorkerOutboxRegistry(enabled, () => value as never),
    ).toThrow("worker_outbox_delivery_capability_unavailable");
  });

  it("does not touch the database when composition receives an invalid registry", () => {
    const transaction = vi.fn();
    expect(() =>
      composeWorkerOutboxDelivery(
        { transaction } as never,
        { topics: LOCAL_OPERATOR_CASE_OUTBOX_TOPICS } as never,
      ),
    ).toThrow("worker_outbox_delivery_capability_unavailable");
    expect(transaction).not.toHaveBeenCalled();
  });
});
