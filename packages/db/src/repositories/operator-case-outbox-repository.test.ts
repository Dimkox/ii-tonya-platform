import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresOperatorCaseOutboxRepository } from "./operator-case-outbox-repository.js";

describe("PostgreSQL operator-case outbox repository", () => {
  it.each([
    {
      outboxId: "not-a-uuid",
      topic: "safety.operator_escalation",
      payload: { handoffId: randomUUID(), version: 1, charge: 0 },
    },
    {
      outboxId: randomUUID(),
      topic: "provider.notification",
      payload: {},
    },
  ])("rejects invalid materialization input before SQL", async (input) => {
    const transaction = vi.fn();
    const repository = new PostgresOperatorCaseOutboxRepository({
      transaction,
    } as unknown as DrizzleDb);

    await expect(repository.materialize(input as never)).rejects.toThrow(
      "local_operator_case_input_invalid",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid inspection input before SQL", async () => {
    const execute = vi.fn();
    const repository = new PostgresOperatorCaseOutboxRepository({
      execute,
    } as unknown as DrizzleDb);

    await expect(
      repository.inspect({
        outboxId: randomUUID(),
        topic: "provider.notification",
      } as never),
    ).rejects.toThrow("local_operator_case_input_invalid");
    expect(execute).not.toHaveBeenCalled();
  });
});
