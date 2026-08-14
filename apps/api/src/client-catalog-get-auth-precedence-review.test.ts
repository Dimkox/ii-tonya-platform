import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientCatalogRoutes } from "./routes/client-catalog.js";

describe("client catalog GET authentication precedence closure", () => {
  it.each([
    { name: "missing", resolve: async () => ({ kind: "denied" as const }), status: 401 },
    {
      name: "revoked",
      resolve: async () => ({ kind: "denied" as const }),
      status: 401,
    },
    {
      name: "resolver error",
      resolve: async () => {
        throw new Error("private resolver detail");
      },
      status: 503,
    },
  ])("fails before malformed-id validation for $name authority", async ({ resolve, status }) => {
    const get = vi.fn();
    const app = Fastify();
    await app.register(clientCatalogRoutes, {
      principals: { resolve },
      catalog: { request: vi.fn(), get } as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/client/catalog-requests/not-a-uuid",
      headers: { authorization: `Bearer cs1.${"A".repeat(43)}` },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({
      error: status === 401 ? "unauthorized" : "temporarily_unavailable",
    });
    expect(get).not.toHaveBeenCalled();
  });
});
