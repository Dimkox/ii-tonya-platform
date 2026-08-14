import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientCatalogRoutes } from "./routes/client-catalog.js";

describe("client catalog GET authentication precedence closure", () => {
  it.each([
    { name: "missing", resolve: async () => null },
    {
      name: "revoked",
      resolve: async () => ({
        authenticated: true,
        active: false,
        userId: "00000000-0000-4000-8000-000000000101",
      }),
    },
    {
      name: "resolver error",
      resolve: async () => {
        throw new Error("private resolver detail");
      },
    },
  ])("returns 401 before malformed-id validation for $name authority", async ({ resolve }) => {
    const get = vi.fn();
    const app = Fastify();
    await app.register(clientCatalogRoutes, {
      principals: { resolve },
      catalog: { request: vi.fn(), get } as never,
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/client/catalog-requests/not-a-uuid",
      headers: { authorization: "Bearer test" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(get).not.toHaveBeenCalled();
  });
});
