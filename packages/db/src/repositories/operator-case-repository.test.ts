import { describe, expect, it, vi } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresOperatorCaseRepository } from "./operator-case-repository.js";

const row = {
  id: "00000000-0000-4000-8000-000000000101",
  type: "negative_feedback",
  status: "acknowledged",
  rating: 1,
  reasonCode: "negative_feedback_policy",
  contentHash: "a".repeat(64),
  policyVersion: "negative-v1",
  createdAt: "2026-08-14T10:00:00.000Z",
  updatedAt: "2026-08-14T10:01:00.000Z",
  acknowledgedAt: "2026-08-14T10:01:00.000Z",
  resolvedAt: null,
} as const;

describe("PostgreSQL operator case repository", () => {
  it("normalizes raw PostgreSQL timestamp strings at the repository boundary", async () => {
    const execute = vi.fn(async () => ({ rows: [row] }));
    const repository = new PostgresOperatorCaseRepository({
      execute,
    } as unknown as DrizzleDb);

    const page = await repository.listUnresolved({
      allowedTypes: ["negative_feedback"],
      limit: 10,
    });

    expect(page.items[0]).toMatchObject({
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      acknowledgedAt: new Date(row.acknowledgedAt),
      resolvedAt: null,
    });
  });

  it("rejects invalid driver timestamps with a fixed non-data error", async () => {
    const execute = vi.fn(async () => ({
      rows: [{ ...row, updatedAt: "not-a-timestamp" }],
    }));
    const repository = new PostgresOperatorCaseRepository({
      execute,
    } as unknown as DrizzleDb);

    await expect(
      repository.listUnresolved({
        allowedTypes: ["negative_feedback"],
        limit: 10,
      }),
    ).rejects.toThrow("operator_case_timestamp_invalid");
  });
});
