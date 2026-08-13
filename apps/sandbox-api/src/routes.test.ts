import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SandboxPaymentConflictError,
  sandboxApprovalObjectId,
} from "@ii-tonya/sandbox-payments";
import { buildSandboxRoutes } from "./routes.js";

const token = "A".repeat(32);
const sessionIdHash = `sha256:${createHash("sha256").update(token).digest("hex")}`;
const paymentId = "sandbox_payment_abcdefghijklmnopqrstuv";
const approvalId = "00000000-0000-4000-8000-000000000020";
const nonce = "nonce-sandbox-route-0001";
const idempotencyKey = "transition-sandbox-route-0001";
const correlationId = "correlation-sandbox-route-0001";

const dependencies = () => ({
  paymentAdapter: {
    assertSandboxDatabase: vi.fn(async () => undefined),
    createCheckout: vi.fn(),
    reconcile: vi.fn(),
  },
  transitionWorkflow: {
    execute: vi.fn(async () => ({
      allowed: true,
      replayed: false,
      event: { eventId: "sandbox_event_abcdefghijklmnopqrstuv" },
    })),
  },
  approvals: {
    resolvePrincipal: vi.fn(async (hash: string) => ({
      id: "00000000-0000-4000-8000-000000000001",
      sessionIdHash: hash,
      roles: ["entitlement_admin"] as const,
      mfaVerifiedAt: new Date(),
    })),
    requestApproval: vi.fn(async () => ({
      approvalId,
      expiresAt: new Date("2026-08-13T12:05:00Z"),
    })),
    approveApproval: vi.fn(async () => true),
  },
});

describe("sandbox payment routes", () => {
  let deps: ReturnType<typeof dependencies>;
  beforeEach(() => {
    deps = dependencies();
  });

  it("renders an inert checkout view without invoking a mutation", async () => {
    const app = await buildSandboxRoutes(deps as never);
    const response = await app.inject({
      method: "GET",
      url: `/sandbox/v1/payments/${paymentId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      kind: "sandbox_checkout",
      paymentId,
      mutable: false,
    });
    expect(deps.transitionWorkflow.execute).not.toHaveBeenCalled();
    expect(deps.paymentAdapter.createCheckout).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([undefined, "bearer " + token, "Bearer short", `Bearer ${token}!`])(
    "requires the exact admin Bearer boundary: %s",
    async (authorization) => {
      const app = await buildSandboxRoutes(deps as never);
      const response = await app.inject({
        method: "POST",
        url: `/sandbox/v1/admin/approvals/expert_residency.sandbox_settle/${paymentId}/request`,
        headers: authorization ? { authorization } : {},
        payload: { nonce, expectedVersion: 0, idempotencyKey },
      });
      expect(response.statusCode).toBe(401);
      expect(deps.approvals.requestApproval).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it("binds approval requests to the exact transition payload and session", async () => {
    const app = await buildSandboxRoutes(deps as never);
    const response = await app.inject({
      method: "POST",
      url: `/sandbox/v1/admin/approvals/expert_residency.sandbox_settle/${paymentId}/request`,
      headers: { authorization: `Bearer ${token}` },
      payload: { nonce, expectedVersion: 0, idempotencyKey },
    });
    expect(response.statusCode).toBe(201);
    expect(deps.approvals.resolvePrincipal).toHaveBeenCalledWith(sessionIdHash);
    expect(deps.approvals.requestApproval).toHaveBeenCalledWith({
      sessionIdHash,
      action: "expert_residency.sandbox_settle",
      objectType: "sandbox_expert_residency_payment",
      objectId: sandboxApprovalObjectId(paymentId),
      payload: {
        paymentId,
        transition: "settled",
        expectedVersion: 0,
        idempotencyKey,
      },
      nonce,
    });
    await app.close();
  });

  it("approves through the authenticated approver session", async () => {
    const app = await buildSandboxRoutes(deps as never);
    const response = await app.inject({
      method: "POST",
      url: `/sandbox/v1/admin/approvals/${approvalId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(deps.approvals.approveApproval).toHaveBeenCalledWith({
      approvalId,
      sessionIdHash,
    });
    await app.close();
  });

  it("executes only the exactly bound approved workflow", async () => {
    const app = await buildSandboxRoutes(deps as never);
    const response = await app.inject({
      method: "POST",
      url: `/sandbox/v1/admin/payments/${paymentId}/transitions/settled`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        approvalId,
        nonce,
        expectedVersion: 0,
        idempotencyKey,
        correlationId,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(deps.transitionWorkflow.execute).toHaveBeenCalledWith({
      action: "expert_residency.sandbox_settle",
      paymentId,
      approvalId,
      nonce,
      sessionIdHash,
      expectedVersion: 0,
      idempotencyKey,
      correlationId,
    });
    await app.close();
  });

  it("rejects extra properties and bodies over 8 KiB", async () => {
    const app = await buildSandboxRoutes(deps as never);
    const extra = await app.inject({
      method: "POST",
      url: `/sandbox/v1/admin/approvals/${approvalId}/approve`,
      headers: { authorization: `Bearer ${token}` },
      payload: { unexpected: true },
    });
    expect(extra.statusCode).toBe(400);
    const oversized = await app.inject({
      method: "POST",
      url: `/sandbox/v1/admin/approvals/${approvalId}/approve`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({ padding: "x".repeat(9 * 1024) }),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("maps conflicts, unavailable dependencies, denial, and unexpected faults safely", async () => {
    const app = await buildSandboxRoutes(deps as never);
    const call = () =>
      app.inject({
        method: "POST",
        url: `/sandbox/v1/admin/payments/${paymentId}/transitions/settled`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          approvalId,
          nonce,
          expectedVersion: 0,
          idempotencyKey,
          correlationId,
        },
      });
    deps.transitionWorkflow.execute.mockRejectedValueOnce(
      new SandboxPaymentConflictError("raw sql secret"),
    );
    expect((await call()).json()).toEqual({ error: "conflict" });
    deps.transitionWorkflow.execute.mockRejectedValueOnce(
      Object.assign(new Error("postgres secret"), {
        code: "SANDBOX_DEPENDENCY_UNAVAILABLE",
      }),
    );
    const unavailable = await call();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ error: "unavailable" });
    deps.transitionWorkflow.execute.mockResolvedValueOnce({
      allowed: false,
      reasonCode: "approval_denied",
    } as never);
    expect((await call()).statusCode).toBe(403);
    deps.transitionWorkflow.execute.mockRejectedValueOnce(
      new Error("stack and credential"),
    );
    const fault = await call();
    expect(fault.statusCode).toBe(500);
    expect(fault.json()).toEqual({ error: "internal_error" });
    await app.close();
  });
});
