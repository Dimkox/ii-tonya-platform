import type {
  AdminPrincipal,
  OperatorCaseService,
} from "@ii-tonya/application";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashAdminSessionToken } from "./admin.js";
import { operatorCaseRoutes } from "./operator-cases.js";

const token = "operator-session-token-0000000000000001";
const caseId = "00000000-0000-4000-8000-000000000101";
const principal: AdminPrincipal = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionIdHash: hashAdminSessionToken(token),
  roles: ["support"],
  mfaVerifiedAt: new Date("2026-08-14T09:59:00.000Z"),
};
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const fixture = async (input: {
  readonly resolved?: AdminPrincipal | null;
  readonly cases: OperatorCaseService;
}) => {
  const app = Fastify();
  apps.push(app);
  const approvals = {
    resolvePrincipal: vi.fn(async () => input.resolved ?? principal),
  };
  await app.register(operatorCaseRoutes, { approvals, cases: input.cases });
  return { app, approvals };
};

describe("operator case API", () => {
  it("lists bounded cases through a freshly resolved role principal", async () => {
    const cases = {
      listOpen: vi.fn(async () => ({
        kind: "ok" as const,
        items: [
          {
            id: caseId,
            type: "negative_feedback" as const,
            status: "open" as const,
            rating: 1 as const,
            reasonCode: "negative_feedback_policy",
            contentHash: "a".repeat(64),
            policyVersion: "negative-v1",
            createdAt: new Date("2026-08-14T10:00:00.000Z"),
            updatedAt: new Date("2026-08-14T10:00:00.000Z"),
            acknowledgedAt: null,
            resolvedAt: null,
          },
        ],
      })),
      transition: vi.fn(),
    } as unknown as OperatorCaseService;
    const { app, approvals } = await fixture({ cases });
    const response = await app.inject({
      method: "GET",
      url: "/v1/admin/operator-cases?limit=25",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(approvals.resolvePrincipal).toHaveBeenCalledWith(
      principal.sessionIdHash,
    );
    expect(cases.listOpen).toHaveBeenCalledWith(principal, { limit: 25 });
    expect(response.json()).toMatchObject({
      items: [{ type: "negative_feedback", rating: 1 }],
    });
    expect(JSON.stringify(response.json())).not.toMatch(/dialogue|feedbackId/u);
  });

  it("transitions a route-bound case with no trusted request body", async () => {
    const cases = {
      listOpen: vi.fn(),
      transition: vi.fn(async () => ({
        kind: "replayed" as const,
        item: { id: caseId, type: "negative_feedback", status: "acknowledged" },
      })),
    } as unknown as OperatorCaseService;
    const { app } = await fixture({ cases });
    const request = {
      method: "POST" as const,
      url: `/v1/admin/operator-cases/${caseId}/acknowledge`,
      headers: { authorization: `Bearer ${token}` },
    };
    expect((await app.inject(request)).statusCode).toBe(200);
    expect(cases.transition).toHaveBeenCalledWith(principal, {
      caseId,
      action: "acknowledge",
    });
    expect((await app.inject({ ...request, payload: {} })).statusCode).toBe(
      400,
    );
  });

  it("fails closed for invalid sessions, roles, lookup and state", async () => {
    const forbidden = {
      listOpen: vi.fn(async () => ({ kind: "forbidden" as const })),
      transition: vi.fn(async () => ({ kind: "forbidden" as const })),
    } as unknown as OperatorCaseService;
    const { app: forbiddenApp } = await fixture({ cases: forbidden });
    expect(
      (
        await forbiddenApp.inject({
          method: "GET",
          url: "/v1/admin/operator-cases?limit=10",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(403);

    const { app: unauthorized } = await fixture({
      resolved: null,
      cases: forbidden,
    });
    expect(
      (
        await unauthorized.inject({
          method: "GET",
          url: "/v1/admin/operator-cases",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);

    for (const [kind, statusCode] of [
      ["not_found", 404],
      ["conflict", 409],
    ] as const) {
      const cases = {
        listOpen: vi.fn(),
        transition: vi.fn(async () => ({ kind })),
      } as unknown as OperatorCaseService;
      const { app } = await fixture({ cases });
      const response = await app.inject({
        method: "POST",
        url: `/v1/admin/operator-cases/${caseId}/resolve`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(statusCode);
    }
  });
});
