import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { expertCardAdminRoutes } from "./expert-cards.js";
const id = "00000000-0000-4000-8000-000000000001";
const auth = {
  authorization: "Bearer synthetic-mfa-session-token-12345678901234567890",
};
async function fixture(enabled = true) {
  const list = vi.fn(async () => ({ kind: "ok" as const, items: [] }));
  const detail = vi.fn(async () => ({
    kind: "ok" as const,
    item: {
      revision: 1,
      entries: [{ kind: "document", reference: "telegram:file:synthetic" }],
    },
  }));
  const edit = vi.fn(async () => ({
    kind: "ok" as const,
    item: { revision: 2 },
  }));
  const review = vi.fn(async () => ({
    kind: "ok" as const,
    item: { revision: 1, state: "approved" },
  }));
  const confirmPromo = vi.fn(async () => ({
    kind: "ok" as const,
    item: { state: "main_ready" },
  }));
  const app = Fastify({ logger: false });
  await app.register(expertCardAdminRoutes, {
    enabled,
    service: { list, detail, edit, review, confirmPromo },
  });
  return { app, list, detail, edit, review, confirmPromo };
}
it("requires existing manager session for raw card access", async () => {
  const f = await fixture();
  expect(
    (await f.app.inject({ method: "GET", url: `/v1/admin/expert-cards/${id}` }))
      .statusCode,
  ).toBe(401);
  expect(f.detail).not.toHaveBeenCalled();
  await f.app.close();
});
it("protects actual raw-reference responses from caching", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "GET",
    url: `/v1/admin/expert-cards/${id}`,
    headers: auth,
  });
  expect(r.statusCode).toBe(200);
  expect(r.headers["cache-control"]).toBe("no-store");
  expect(f.detail).toHaveBeenCalledWith(expect.stringMatching(/^sha256:/u), id);
  await f.app.close();
});
it("lists revision queue through same manager authority", async () => {
  const f = await fixture();
  expect(
    (
      await f.app.inject({
        method: "GET",
        url: "/v1/admin/expert-cards?limit=20",
        headers: auth,
      })
    ).statusCode,
  ).toBe(200);
  expect(f.list).toHaveBeenCalledWith(expect.stringMatching(/^sha256:/u), {
    limit: 20,
  });
  await f.app.close();
});
it("forwards explicit manager card review with expected revision", async () => {
  const f = await fixture();
  expect(
    (
      await f.app.inject({
        method: "POST",
        url: `/v1/admin/expert-cards/${id}/review`,
        headers: auth,
        payload: {
          expectedRevision: 1,
          action: "approve",
          idempotencyKey: "synthetic-card-review",
        },
      })
    ).statusCode,
  ).toBe(200);
  expect(f.review).toHaveBeenCalledWith(expect.stringMatching(/^sha256:/u), {
    applicationId: id,
    expectedRevision: 1,
    action: "approve",
    idempotencyKey: "synthetic-card-review",
  });
  await f.app.close();
});
it("rejects public sent/paid/active authority for promo confirmation", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "POST",
    url: `/v1/admin/expert-cards/${id}/promo-review`,
    headers: auth,
    payload: {
      expectedRevision: 1,
      idempotencyKey: "synthetic-promo-review",
      sent: true,
    },
  });
  expect(r.statusCode).toBe(400);
  expect(f.confirmPromo).not.toHaveBeenCalled();
  await f.app.close();
});
it("exposes revision conflict as bounded conflict response", async () => {
  const f = await fixture();
  f.review.mockResolvedValueOnce({ kind: "conflict" } as never);
  const r = await f.app.inject({
    method: "POST",
    url: `/v1/admin/expert-cards/${id}/review`,
    headers: auth,
    payload: {
      expectedRevision: 1,
      action: "approve",
      idempotencyKey: "synthetic-card-review",
    },
  });
  expect(r.statusCode).toBe(409);
  expect(r.json()).toEqual({ error: "conflict" });
  await f.app.close();
});
it("does not register the card surface when disabled", async () => {
  const f = await fixture(false);
  expect(
    (await f.app.inject({ method: "GET", url: "/v1/admin/expert-cards" }))
      .statusCode,
  ).toBe(404);
  await f.app.close();
});
