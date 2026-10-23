import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { expertVerificationRoutes } from "./expert-verification.js";
const id = "00000000-0000-4000-8000-000000000001";
const token = "synthetic-session-token-12345678901234567890";
async function fixture(enabled = true) {
  const list = vi.fn(async () => ({ kind: "ok" as const, items: [] }));
  const detail = vi.fn(async () => ({
    kind: "ok" as const,
    item: {
      applicationId: id,
      questionnaire: {
        status: "waiting_content",
        contentSlot: "TODO: Wait for Content Spec",
      },
    },
  }));
  const decide = vi.fn(async () => ({
    kind: "ok" as const,
    applicationId: id,
    decision: "approved" as const,
    invoiceId: id,
    replay: false,
    payment: { status: "waiting_configuration" as const },
  }));
  const checkout = vi.fn(async () => ({
    kind: "ok" as const,
    payment: { status: "pending" as const },
  }));
  const app = Fastify({ logger: false });
  await app.register(expertVerificationRoutes, {
    enabled,
    service: { list, detail, decide, checkout },
  });
  return { app, list, detail, decide, checkout };
}
it("requires an existing bearer session before accessing manager queue", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "GET",
    url: "/v1/admin/expert-verification",
  });
  expect(r.statusCode).toBe(401);
  expect(f.list).not.toHaveBeenCalled();
  await f.app.close();
});
it("hashes manager token rather than sending plaintext to service", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "GET",
    url: "/v1/admin/expert-verification?limit=20",
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(200);
  expect(f.list).toHaveBeenCalledWith(
    expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    { limit: 20 },
  );
  await f.app.close();
});
it("protects questionnaire detail with same session path", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "GET",
    url: `/v1/admin/expert-verification/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(200);
  expect(f.detail).toHaveBeenCalledWith(expect.stringMatching(/^sha256:/u), id);
  await f.app.close();
});
it("rejects client financial authority fields", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "POST",
    url: `/v1/admin/expert-verification/${id}/decision`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      decision: "approved",
      reasonCode: "verified",
      idempotencyKey: "synthetic-key-123",
      amountMinor: "1",
    },
  });
  expect(r.statusCode).toBe(400);
  expect(f.decide).not.toHaveBeenCalled();
  await f.app.close();
});
it("accepts bounded manager decision only", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "POST",
    url: `/v1/admin/expert-verification/${id}/decision`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      decision: "approved",
      reasonCode: "verified",
      idempotencyKey: "synthetic-key-123",
    },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().payment.status).toBe("waiting_configuration");
  await f.app.close();
});
it("does not register an enabled incomplete capability", async () => {
  const app = Fastify({ logger: false });
  await expect(
    app.register(expertVerificationRoutes, { enabled: true }),
  ).rejects.toThrow("expert_verification_capability_required");
  await app.close();
});
it("omits manager routes when disabled", async () => {
  const f = await fixture(false);
  expect(
    (
      await f.app.inject({
        method: "GET",
        url: "/v1/admin/expert-verification",
      })
    ).statusCode,
  ).toBe(404);
  await f.app.close();
});
it("returns bounded failure without source error prose", async () => {
  const f = await fixture();
  f.detail.mockRejectedValueOnce(new Error("synthetic-contact-secret"));
  const r = await f.app.inject({
    method: "GET",
    url: `/v1/admin/expert-verification/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(503);
  expect(r.body).not.toContain("synthetic-contact-secret");
  await f.app.close();
});

it("supports explicit invoice-bound recovery without replaying manager decision", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "POST",
    url: `/v1/admin/expert-verification/invoices/${id}/checkout`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(200);
  expect(f.checkout).toHaveBeenCalledWith(
    expect.stringMatching(/^sha256:/u),
    id,
  );
  expect(f.decide).not.toHaveBeenCalled();
  await f.app.close();
});

it("marks protected manager contact responses no-store", async () => {
  const f = await fixture();
  const r = await f.app.inject({
    method: "GET",
    url: `/v1/admin/expert-verification/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.statusCode).toBe(200);
  expect(r.headers["cache-control"]).toBe("no-store");
  await f.app.close();
});
