import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { clientCatalogRoutes } from "./routes/client-catalog.js";

describe("client catalog authentication precedence remediation", () => {
  it("returns 401 before semantic body validation or service access", async () => {
    const request = vi.fn();
    const app = Fastify({
      bodyLimit: 64_000,
      ajv: { customOptions: { removeAdditional: false } },
    });
    await app.register(clientCatalogRoutes, {
      principals: { resolve: async () => ({ kind: "denied" }) },
      catalog: { request, get: vi.fn() } as never,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/client/catalog-requests",
      payload: { serviceCode: 1, extra: true },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(request).not.toHaveBeenCalled();
  });
});
