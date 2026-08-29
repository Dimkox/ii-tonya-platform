import Fastify from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { selartiResponseRoutes } from "./selarti-response.js";

const secret = "B2_Response_Shared_Secret_0123456789abcdef";
const body = {
  version: 1,
  requestId: `sha256:${"a".repeat(64)}`,
  dialogueId: "00000000-0000-4000-8000-000000000501",
  threadId: `sha256:${"a".repeat(64)}`,
  text: "Ответ",
};

const build = async (
  enabled: boolean,
  handle: (raw: unknown) => Promise<{ status: string }>,
) => {
  const app = Fastify({ logger: false });
  await app.register(selartiResponseRoutes, {
    enabled,
    secret,
    responses: { handle },
    rateLimiter: { consume: () => true },
  });
  return app;
};

describe("dedicated Selarti response endpoint", () => {
  const handle = vi.fn(async () => ({ status: "accepted" }));
  let app: Awaited<ReturnType<typeof build>>;
  let disabledApp: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    app = await build(true, handle);
    disabledApp = await build(false, handle);
  });

  beforeEach(() => {
    handle.mockReset();
    handle.mockResolvedValue({ status: "accepted" });
  });

  afterAll(async () => {
    await Promise.all([app.close(), disabledApp.close()]);
  });

  it.each([undefined, "Bearer wrong-secret"])(
    "rejects missing or wrong authentication before service",
    async (authorization) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/webhooks/selarti/responses",
        headers: authorization ? { authorization } : {},
        payload: body,
      });
      expect(response.statusCode).toBe(401);
      expect(handle).not.toHaveBeenCalled();
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
    handle.mockResolvedValue({ status });
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
    expect(response.statusCode).toBe(expectedCode);
    expect(response.json()).toEqual(expectedBody);
  });

  it("keeps the endpoint unavailable while its independent flag is off", async () => {
    const response = await disabledApp.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
    expect(response.statusCode).toBe(503);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when the transactional service throws", async () => {
    handle.mockRejectedValue(new Error("database unavailable"));
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/selarti/responses",
      headers: { authorization: `Bearer ${secret}` },
      payload: body,
    });
    expect(response.statusCode).toBe(503);
  });
});
