import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { selartiResponseRoutes } from "./selarti-response.js";

const secret = "B2_Response_Shared_Secret_0123456789abcdef";
const body = {
  version: 1,
  requestId: `sha256:${"a".repeat(64)}`,
  dialogueId: "00000000-0000-4000-8000-000000000501",
  threadId: `sha256:${"a".repeat(64)}`,
  text: "Ответ",
};

const build = async (input?: {
  enabled?: boolean;
  handle?: (raw: unknown) => Promise<{ status: string }>;
}) => {
  const handle = vi.fn(input?.handle ?? (async () => ({ status: "accepted" })));
  const app = Fastify({ logger: false });
  await app.register(selartiResponseRoutes, {
    enabled: input?.enabled ?? true,
    secret,
    responses: { handle },
    rateLimiter: { consume: () => true },
  });
  return { app, handle };
};

describe("dedicated Selarti response endpoint", () => {
  it.each([undefined, "Bearer wrong-secret"])(
    "rejects missing or wrong authentication before service",
    async (authorization) => {
      const state = await build();
      try {
        const response = await state.app.inject({
          method: "POST",
          url: "/v1/webhooks/selarti/responses",
          headers: authorization ? { authorization } : {},
          payload: body,
        });
        expect(response.statusCode).toBe(401);
        expect(state.handle).not.toHaveBeenCalled();
      } finally {
        await state.app.close();
      }
    },
  );

  it.each([
    ["accepted", 200, { accepted: true }],
    ["duplicate", 200, { accepted: true, duplicate: true }],
    ["rejected", 200, { accepted: true, rejected: true }],
    ["conflict", 200, { accepted: true, rejected: true }],
    ["late", 200, { accepted: true, rejected: true }],
    ["unavailable", 503, { error: "selarti_response_unavailable" }],
  ])("maps %s to HTTP %s", async (status, expectedCode, expectedBody) => {
    const state = await build({ handle: async () => ({ status }) });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti/responses",
        headers: { authorization: `Bearer ${secret}` },
        payload: body,
      });
      expect(response.statusCode).toBe(expectedCode);
      expect(response.json()).toEqual(expectedBody);
    } finally {
      await state.app.close();
    }
  });

  it("keeps the endpoint unavailable while its independent flag is off", async () => {
    const state = await build({ enabled: false });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti/responses",
        headers: { authorization: `Bearer ${secret}` },
        payload: body,
      });
      expect(response.statusCode).toBe(503);
      expect(state.handle).not.toHaveBeenCalled();
    } finally {
      await state.app.close();
    }
  });

  it("returns retryable 503 when the transactional service throws", async () => {
    const state = await build({
      handle: async () => {
        throw new Error("database unavailable");
      },
    });
    try {
      const response = await state.app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti/responses",
        headers: { authorization: `Bearer ${secret}` },
        payload: body,
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await state.app.close();
    }
  });
});
