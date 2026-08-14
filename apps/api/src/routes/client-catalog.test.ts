import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import type {
  ClientCatalogService,
  ClientPrincipalResolver,
} from "@ii-tonya/application";
import { clientCatalogRoutes } from "./client-catalog.js";

const userId = "00000000-0000-4000-8000-000000000101";
const catalogRequestId = "00000000-0000-4000-8000-000000000201";

const build = async (overrides: {
  resolver?: ClientPrincipalResolver;
  service?: ClientCatalogService;
} = {}) => {
  const request = vi.fn<ClientCatalogService["request"]>(async () => ({
    catalogRequestId,
    state: "pending",
  }));
  const get = vi.fn<ClientCatalogService["get"]>(async () => ({
    catalogRequestId,
    state: "pending",
  }));
  const app = Fastify({
    bodyLimit: 64_000,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(clientCatalogRoutes, {
    principals:
      overrides.resolver ??
      ({
        resolve: async () => ({
          authenticated: true,
          active: true,
          userId,
        }),
      } satisfies ClientPrincipalResolver),
    catalog: overrides.service ?? { request, get },
  });
  return { app, request, get };
};

describe("client catalog HTTP contract", () => {
  it("returns the same bounded 202 receipt for creation and replay", async () => {
    const state = await build();

    const response = await state.app.inject({
      method: "POST",
      url: "/v1/client/catalog-requests",
      headers: { authorization: "Bearer test" },
      payload: { serviceCode: "career", language: "ru" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ catalogRequestId, state: "pending" });
    expect(state.request).toHaveBeenCalledWith(
      { authenticated: true, active: true, userId },
      { serviceCode: "career", language: "ru" },
    );
  });

  it.each([
    { payload: [], error: "invalid_request" },
    { payload: { extra: true }, error: "invalid_request" },
    { payload: { serviceCode: 1 }, error: "invalid_request" },
    { payload: { language: "" }, error: "invalid_request" },
    { payload: { language: "   " }, error: "invalid_request" },
    { payload: { serviceCode: "bad\u0000code" }, error: "invalid_request" },
  ])("rejects a non-contract body: $payload", async ({ payload, error }) => {
    const state = await build();
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/client/catalog-requests",
      headers: { authorization: "Bearer test" },
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
    expect(state.request).not.toHaveBeenCalled();
  });

  it("enforces the route-local 8 KiB body cap", async () => {
    const state = await build();
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/client/catalog-requests",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
      },
      payload: JSON.stringify({ serviceCode: "x".repeat(8_193) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ error: "payload_too_large" });
    expect(state.request).not.toHaveBeenCalled();
  });

  it.each([
    { name: "missing", resolver: { resolve: async () => null } },
    {
      name: "resolver error",
      resolver: {
        resolve: async () => {
          throw new Error("private lookup detail");
        },
      },
    },
  ])("returns 401 before service access for $name authority", async ({ resolver }) => {
    const state = await build({ resolver });
    const response = await state.app.inject({
      method: "POST",
      url: "/v1/client/catalog-requests",
      headers: { authorization: "Bearer test" },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
    expect(state.request).not.toHaveBeenCalled();
  });

  it("returns only public ready snapshot fields", async () => {
    const get = vi.fn<ClientCatalogService["get"]>(async () => ({
      catalogRequestId,
      state: "ready",
      cards: [
        {
          displayName: "Expert",
          serviceCode: "career",
          language: "ru",
          availability: "fresh_slots",
          slots: [{ startsAt: "2026-08-16T10:00:00.000Z" }],
        },
      ],
    }));
    const state = await build({
      service: { request: async () => ({ catalogRequestId, state: "pending" }), get },
    });

    const response = await state.app.inject({
      method: "GET",
      url: `/v1/client/catalog-requests/${catalogRequestId}`,
      headers: { authorization: "Bearer test" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      catalogRequestId,
      state: "ready",
      cards: [
        {
          displayName: "Expert",
          serviceCode: "career",
          language: "ru",
          availability: "fresh_slots",
          slots: [{ startsAt: "2026-08-16T10:00:00.000Z" }],
        },
      ],
    });
  });

  it.each(["missing", "foreign", "expired"])(
    "maps %s owner lookup to the identical 404",
    async () => {
      const state = await build({
        service: {
          request: async () => ({ catalogRequestId, state: "pending" }),
          get: async () => null,
        },
      });
      const response = await state.app.inject({
        method: "GET",
        url: `/v1/client/catalog-requests/${catalogRequestId}`,
        headers: { authorization: "Bearer test" },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "not_found" });
    },
  );
});
