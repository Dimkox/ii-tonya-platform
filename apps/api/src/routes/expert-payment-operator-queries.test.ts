import { expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import type { DrizzleDb } from "@ii-tonya/db";
import {
  createAdminService,
  type AdminDependencies,
} from "../../../../packages/application/src/admin-service.js";
import { createDefaultLifecycle } from "../server.js";
import { buildApp } from "../app.js";
import { buildAdminApi, hashAdminSessionToken } from "./admin.js";

const path = "/v1/admin/expert-residency/late-payments";
const token = "a".repeat(40),
  sessionIdHash = hashAdminSessionToken(token);
const principal = {
  id: "11111111-1111-4111-8111-111111111111",
  sessionIdHash,
  roles: ["support"] as const,
  mfaVerifiedAt: new Date(),
};
async function setup(
  options: {
    roles?: string[];
    anonymous?: boolean;
    missing?: boolean;
    denied?: boolean;
    throws?: boolean;
  } = {},
) {
  const queries = {
    listLatePayments: vi.fn(async () => {
      if (options.throws) throw new Error("secret-database-info");
      return options.denied
        ? { allowed: false, reasonCode: "forbidden" }
        : { allowed: true, items: [] };
    }),
    getLatePayment: vi.fn(async () => ({ allowed: true, item: null })),
  };
  const admin = createAdminService({
    workflows: {} as AdminDependencies["workflows"],
    ...(!options.missing ? { queries } : {}),
  } as AdminDependencies);
  const approvals = {
    resolvePrincipal: vi.fn(async () =>
      options.anonymous
        ? null
        : { ...principal, roles: options.roles ?? principal.roles },
    ),
    requestApproval: vi.fn(),
    approveApproval: vi.fn(),
  };
  const app = await buildAdminApi({
    admin,
    approvals: approvals as Parameters<typeof buildAdminApi>[0]["approvals"],
  });
  return { app, queries };
}
it.each([
  { name: "valid", code: 200 },
  { name: "anonymous", anonymous: true, code: 401 },
  { name: "role", roles: ["catalog_admin"], code: 403 },
  { name: "missing", missing: true, code: 503 },
  { name: "denied", denied: true, code: 403 },
  { name: "throws", throws: true, code: 500 },
])("list $name is authenticated, fail closed and no-store", async (options) => {
  const { app, queries } = await setup(options);
  try {
    const r = await app.inject({
      url: path + "?limit=10",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(options.code);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).not.toContain("secret");
    if (
      options.code === 401 ||
      options.name === "role" ||
      options.name === "missing"
    )
      expect(queries.listLatePayments).not.toHaveBeenCalled();
    if (options.code === 200)
      expect(queries.listLatePayments).toHaveBeenCalledWith({
        sessionIdHash,
        limit: 10,
        status: "open",
      });
  } finally {
    await app.close();
  }
});
it.each([
  "",
  "?limit=0",
  "?limit=101",
  "?limit=01",
  "?limit=1.5",
  "?limit=10&status=all",
  "?limit=10&beforeId=11111111-1111-4111-8111-111111111111",
  "?limit=10&identity=other",
  "?limit=10&limit=20",
])("rejects noncanonical list query %s", async (query) => {
  const { app, queries } = await setup();
  try {
    const r = await app.inject({
      url: path + query,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(queries.listLatePayments).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it("detail returns not found for missing binding without disclosing evidence", async () => {
  const { app, queries } = await setup();
  try {
    const r = await app.inject({
      url: path + "/11111111-1111-4111-8111-111111111111",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not_found" });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(queries.getLatePayment).toHaveBeenCalledWith({
      sessionIdHash,
      errorId: principal.id,
    });
  } finally {
    await app.close();
  }
});
it("actual server dependencies wire the real repository read into authenticated HTTP", async () => {
  const execute = vi.fn(async () => ({
    rows: [{ authorized: true, items: [] }],
  }));
  const dependencies = await createDefaultLifecycle().dependencies(
    loadEnv({
      DATABASE_URL: "postgresql://local:local@localhost/test",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
    }),
    { execute } as unknown as DrizzleDb,
  );
  const app = await buildAdminApi({
    admin: dependencies.adminService!,
    approvals: {
      resolvePrincipal: async () => principal,
      requestApproval: vi.fn(),
      approveApproval: vi.fn(),
    },
  });
  try {
    const r = await app.inject({
      url: path + "?limit=10",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ items: [] });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

// Added before outer forwarding implementation; intentionally unrun until the
// coordinator's reserved final3. No separate RED execution is claimed.
it("outer buildApp forwards list cursor, auth, detail payload/status and no-store", async () => {
  const summary = {
    id: principal.id,
    reasonCode: "expert_residency_paid_after_deadline",
    status: "open" as const,
    createdAt: "2026-10-12T00:00:00.000001Z",
    updatedAt: "2026-10-12T00:00:00.000001Z",
    resolvedAt: null,
  };
  const detail = {
    ...summary,
    inboxId: principal.id,
    orderId: principal.id,
    provider: "synthetic",
    paymentId: "payment-1",
    amountMinor: 50000,
    currency: "RUB",
  };
  const listLatePayments = vi.fn(async () => ({
    allowed: true as const,
    items: [summary],
  }));
  const getLatePayment = vi.fn(async () => ({
    allowed: true as const,
    item: detail,
  }));
  const dependencies = await createDefaultLifecycle().dependencies(
    loadEnv({
      DATABASE_URL: "postgresql://local:local@localhost/test",
      ALLOW_INSECURE_LOCAL_DATABASE: "true",
    }),
    { execute: async () => ({ rows: [] }) } as unknown as DrizzleDb,
  );
  const resolvePrincipal = vi.fn(async () => principal);
  const app = await buildApp({
    ...dependencies,
    adminService: createAdminService({
      workflows: {} as AdminDependencies["workflows"],
      queries: { listLatePayments, getLatePayment },
    }),
    adminApprovals: {
      resolvePrincipal,
      requestApproval: vi.fn(),
      approveApproval: vi.fn(),
    },
  });
  try {
    const query = new URLSearchParams({
      limit: "2",
      status: "resolved",
      beforeCreatedAt: summary.createdAt,
      beforeId: principal.id,
    });
    const list = await app.inject({
      url: `${path}?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json()).toEqual({ items: [summary] });
    expect(resolvePrincipal).toHaveBeenCalledWith(sessionIdHash);
    expect(listLatePayments).toHaveBeenCalledWith({
      sessionIdHash,
      limit: 2,
      status: "resolved",
      beforeCreatedAt: summary.createdAt,
      beforeId: principal.id,
    });
    const response = await app.inject({
      url: `${path}/${principal.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ item: detail });
    expect(getLatePayment).toHaveBeenCalledWith({
      sessionIdHash,
      errorId: principal.id,
    });
  } finally {
    await app.close();
  }
});

it.each(["anonymous", "role", "database", "missing"] as const)(
  "outer buildApp preserves %s denial for both read paths",
  async (kind) => {
    const query = vi.fn(async () => ({
      allowed: false as const,
      reasonCode: "forbidden" as const,
    }));
    const dependencies = await createDefaultLifecycle().dependencies(
      loadEnv({
        DATABASE_URL: "postgresql://local:local@localhost/test",
        ALLOW_INSECURE_LOCAL_DATABASE: "true",
      }),
      { execute: async () => ({ rows: [] }) } as unknown as DrizzleDb,
    );
    const app = await buildApp({
      ...dependencies,
      adminService: createAdminService({
        workflows: {} as AdminDependencies["workflows"],
        ...(kind === "missing"
          ? {}
          : { queries: { listLatePayments: query, getLatePayment: query } }),
      }),
      adminApprovals: {
        resolvePrincipal: async () => ({
          ...principal,
          roles: kind === "role" ? ["catalog_admin"] : principal.roles,
        }),
        requestApproval: vi.fn(),
        approveApproval: vi.fn(),
      },
    });
    try {
      for (const url of [`${path}?limit=10`, `${path}/${principal.id}`]) {
        const response = await app.inject({
          url,
          headers:
            kind === "anonymous" ? {} : { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(
          kind === "anonymous" ? 401 : kind === "missing" ? 503 : 403,
        );
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json()).toEqual({
          error:
            kind === "anonymous"
              ? "unauthorized"
              : kind === "missing"
                ? "unavailable"
                : "forbidden",
        });
      }
      expect(query).toHaveBeenCalledTimes(kind === "database" ? 2 : 0);
    } finally {
      await app.close();
    }
  },
);
