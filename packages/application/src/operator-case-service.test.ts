import { describe, expect, it, vi } from "vitest";
import {
  createOperatorCaseService,
  type OperatorCase,
  type OperatorCaseRepository,
} from "./operator-case-service.js";
import type { AdminPrincipal } from "./admin-service.js";

const support: AdminPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionIdHash: "sha256:support",
  roles: ["support"],
  mfaVerifiedAt: new Date("2026-08-14T09:59:00.000Z"),
};
const security: AdminPrincipal = {
  ...support,
  id: "00000000-0000-4000-8000-000000000002",
  sessionIdHash: "sha256:security",
  roles: ["security_admin"],
};
const negative: OperatorCase = {
  id: "00000000-0000-4000-8000-000000000101",
  type: "negative_feedback",
  status: "open",
  rating: 1,
  reasonCode: "negative_feedback_policy",
  contentHash: "a".repeat(64),
  policyVersion: "negative-v1",
  createdAt: new Date("2026-08-14T10:00:00.000Z"),
  updatedAt: new Date("2026-08-14T10:00:00.000Z"),
  acknowledgedAt: null,
  resolvedAt: null,
};

const repository = (): OperatorCaseRepository => ({
  listUnresolved: vi.fn(async () => ({ items: [negative], hasMore: true })),
  transition: vi.fn(async () => ({ kind: "updated" as const, item: negative })),
});

describe("operator case service", () => {
  it("maps support visibility and round-trips only a bounded server cursor", async () => {
    const cases = repository();
    const service = createOperatorCaseService({ cases });
    const first = await service.listOpen(support, { limit: 1 });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") throw new Error("list denied");
    expect(first.items).toEqual([negative]);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{16,256}$/u);
    if (first.nextCursor === undefined) throw new Error("cursor not issued");
    expect(cases.listUnresolved).toHaveBeenCalledWith({
      allowedTypes: ["negative_feedback", "delivery_failure"],
      limit: 1,
    });

    await service.listOpen(support, {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(cases.listUnresolved).toHaveBeenLastCalledWith({
      allowedTypes: ["negative_feedback", "delivery_failure"],
      limit: 1,
      cursor: { createdAt: negative.createdAt, id: negative.id },
    });
  });

  it("gives security operators only safety cases unless support is also assigned", async () => {
    const cases = repository();
    const service = createOperatorCaseService({ cases });
    await service.listOpen(security, { limit: 20 });
    expect(cases.listUnresolved).toHaveBeenCalledWith({
      allowedTypes: ["safety"],
      limit: 20,
    });
    await service.listOpen(
      { ...security, roles: ["security_admin", "support"] },
      { limit: 20 },
    );
    expect(cases.listUnresolved).toHaveBeenLastCalledWith({
      allowedTypes: ["safety", "negative_feedback", "delivery_failure"],
      limit: 20,
    });
  });

  it("fails unauthorized roles and malformed pagination before repository access", async () => {
    const cases = repository();
    const service = createOperatorCaseService({ cases });
    await expect(
      service.listOpen({ ...support, roles: ["catalog_admin"] }, { limit: 20 }),
    ).resolves.toEqual({ kind: "forbidden" });
    await expect(service.listOpen(support, { limit: 0 })).resolves.toEqual({
      kind: "invalid",
    });
    await expect(
      service.listOpen(support, { limit: 20, cursor: "not-a-valid-cursor" }),
    ).resolves.toEqual({ kind: "invalid" });
    expect(cases.listUnresolved).not.toHaveBeenCalled();
  });

  it("passes an authenticated, role-bounded transition without trusting a case type", async () => {
    const cases = repository();
    const service = createOperatorCaseService({ cases });
    await service.transition(support, {
      caseId: negative.id,
      action: "acknowledge",
    });
    expect(cases.transition).toHaveBeenCalledWith({
      caseId: negative.id,
      action: "acknowledge",
      allowedTypes: ["negative_feedback", "delivery_failure"],
      actorId: support.id,
      sessionIdHash: support.sessionIdHash,
    });
  });
});
