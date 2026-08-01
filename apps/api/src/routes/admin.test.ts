import type { AdminPrincipal, AdminService } from "@ii-tonya/application";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_LOG_REDACT_PATHS,
  buildAdminApi,
  hashAdminSessionToken,
  type AdminApiDependencies,
} from "./admin.js";

const requesterToken = "requester-session-token-0000000000000001";
const requester: AdminPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionIdHash: hashAdminSessionToken(requesterToken),
  roles: ["entitlement_admin"],
  mfaVerifiedAt: new Date("2026-08-01T10:00:00.000Z"),
};
const userId = "00000000-0000-4000-8000-000000000010";
const approvalId = "00000000-0000-4000-8000-000000000020";
const nonce = "nonce-request-0001";
const correlationId = "correlation-request-0001";

const apps: Awaited<ReturnType<typeof buildAdminApi>>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(async (app) => app.close())));

function fixture(input: {
  readonly principal?: AdminPrincipal | null;
  readonly allowed?: boolean;
  readonly rateLimitMax?: number;
} = {}) {
  const principal = input.principal === undefined ? requester : input.principal;
  const allowed = input.allowed ?? true;
  const workflowResult = allowed
    ? { allowed: true as const, replayed: false, packageId: "00000000-0000-4000-8000-000000000030" }
    : { allowed: false as const, reasonCode: "approval_denied" as const };
  const admin = {
    createClient: vi.fn(), deactivateClient: vi.fn(),
    grantPackage: vi.fn(async () => workflowResult), grantIntroPackage: vi.fn(),
    revokePackage: vi.fn(), updateExpertVerification: vi.fn(),
    updateService: vi.fn(), resolveIntegrationError: vi.fn(), resolveAlert: vi.fn(),
  } as unknown as AdminService;
  const approvals = {
    resolvePrincipal: vi.fn(async () => principal),
    requestApproval: vi.fn(async () => ({ approvalId, expiresAt: new Date("2026-08-01T10:05:00.000Z") })),
    approveApproval: vi.fn(async () => true),
  };
  const deps: AdminApiDependencies = input.rateLimitMax === undefined
    ? { approvals, admin }
    : { approvals, admin, rateLimitMax: input.rateLimitMax };
  return { deps, approvals, admin };
}

async function appFor(deps: AdminApiDependencies) {
  const app = await buildAdminApi(deps);
  apps.push(app);
  return app;
}

describe("hardened admin API", () => {
  it("rejects missing or malformed bearer credentials without consulting a session", async () => {
    const { deps, approvals } = fixture();
    const app = await appFor(deps);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/actions/package.grant/${userId}/approvals`,
      payload: { nonce, command: { units: 500, idempotencyKey: "grant-request-0001" } },
    });
    expect(response.statusCode).toBe(401);
    expect(approvals.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("hashes the bearer token and builds a target-bound approval payload server-side", async () => {
    const { deps, approvals } = fixture();
    const app = await appFor(deps);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/actions/package.grant/${userId}/approvals`,
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: { nonce, command: { units: 500, idempotencyKey: "grant-request-0001" } },
    });
    expect(response.statusCode).toBe(201);
    expect(approvals.resolvePrincipal).toHaveBeenCalledWith(requester.sessionIdHash);
    expect(approvals.requestApproval).toHaveBeenCalledWith({
      sessionIdHash: requester.sessionIdHash,
      action: "package.grant",
      objectType: "user",
      objectId: userId,
      payload: { userId, units: 500, idempotencyKey: "grant-request-0001" },
      nonce,
    });
  });

  it("rejects actor, target, and unexpected command fields", async () => {
    const { deps, approvals } = fixture();
    const app = await appFor(deps);
    const actorResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/actions/package.grant/${userId}/approvals`,
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: { actorId: requester.id, nonce, command: { units: 500, idempotencyKey: "grant-request-0001" } },
    });
    const targetResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/actions/package.grant/${userId}/approvals`,
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: { nonce, command: { userId, units: 500, idempotencyKey: "grant-request-0001" } },
    });
    expect(actorResponse.statusCode).toBe(400);
    expect(targetResponse.statusCode).toBe(400);
    expect(approvals.requestApproval).not.toHaveBeenCalled();
  });

  it("approves only through the authenticated approver session", async () => {
    const approverToken = "approver-session-token-0000000000000002";
    const approver = { ...requester, id: "00000000-0000-4000-8000-000000000002", sessionIdHash: hashAdminSessionToken(approverToken) };
    const { deps, approvals } = fixture({ principal: approver });
    const app = await appFor(deps);
    const response = await app.inject({
      method: "POST",
      url: `/v1/admin/approvals/${approvalId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
    });
    expect(response.statusCode).toBe(204);
    expect(approvals.approveApproval).toHaveBeenCalledWith({
      approvalId,
      sessionIdHash: approver.sessionIdHash,
    });
    const forgedBody = await app.inject({
      method: "POST",
      url: `/v1/admin/approvals/${approvalId}/approve`,
      headers: { authorization: `Bearer ${approverToken}` },
      payload: { approverId: approver.id },
    });
    expect(forgedBody.statusCode).toBe(400);
  });

  it("rejects coercible command values and a mismatched resolved session", async () => {
    const mismatch = { ...requester, sessionIdHash: "sha256:forged-session" };
    const mismatchedFixture = fixture({ principal: mismatch });
    const mismatchedApp = await appFor(mismatchedFixture.deps);
    const base = {
      method: "POST" as const,
      url: `/v1/admin/actions/package.grant/${userId}/approvals`,
      headers: { authorization: `Bearer ${requesterToken}` },
    };
    expect((await mismatchedApp.inject({
      ...base,
      payload: { nonce, command: { units: 500, idempotencyKey: "grant-request-0001" } },
    })).statusCode).toBe(401);

    const normalFixture = fixture();
    const normalApp = await appFor(normalFixture.deps);
    expect((await normalApp.inject({
      ...base,
      payload: { nonce, command: { units: "500", idempotencyKey: "grant-request-0001" } },
    })).statusCode).toBe(400);
    expect(normalFixture.approvals.requestApproval).not.toHaveBeenCalled();
  });

  it("executes the exact route-bound command and returns fail-closed denial", async () => {
    const allowedFixture = fixture();
    const allowedApp = await appFor(allowedFixture.deps);
    const request = {
      method: "POST" as const,
      url: `/v1/admin/actions/package.grant/${userId}/execute`,
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: { approvalId, nonce, correlationId, command: { units: 1000, idempotencyKey: "grant-execute-0001" } },
    };
    const allowed = await allowedApp.inject(request);
    expect(allowed.statusCode).toBe(200);
    expect(allowedFixture.admin.grantPackage).toHaveBeenCalledWith(requester, {
      routeObjectId: userId,
      userId,
      units: 1000,
      idempotencyKey: "grant-execute-0001",
      approvalId,
      nonce,
      correlationId,
    });

    const deniedFixture = fixture({ allowed: false });
    const denied = await (await appFor(deniedFixture.deps)).inject(request);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: "approval_denied" });
  });

  it("rate limits admin operations and declares credential/body redaction", async () => {
    const { deps } = fixture({ rateLimitMax: 1 });
    const app = await appFor(deps);
    const request = {
      method: "POST" as const,
      url: `/v1/admin/actions/package.grant/${userId}/approvals`,
      headers: { authorization: `Bearer ${requesterToken}` },
      payload: { nonce, command: { units: 500, idempotencyKey: "grant-request-0001" } },
    };
    expect((await app.inject(request)).statusCode).toBe(201);
    expect((await app.inject(request)).statusCode).toBe(429);
    expect(ADMIN_LOG_REDACT_PATHS).toContain("req.headers.authorization");
    expect(ADMIN_LOG_REDACT_PATHS).toContain("body");
  });
});
