import { expect, it, vi } from "vitest";
import { ExpertVerificationClient } from "./expert-verification-client.js";
const id = "11111111-1111-4111-8111-111111111111";
const token = "synthetic-session-token-1234567890";
const entry = {
  applicationId: id,
  status: "pending",
  maskedContact: "telegram:***",
  quoteId: id,
  termMonths: 1,
  priceMinor: "999000",
  currency: "RUB",
};
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
it("reads masked queue with memory session and protected fetch options", async () => {
  const fetcher = vi.fn(async () => response({ kind: "ok", items: [entry] }));
  const client = new ExpertVerificationClient(token, fetcher);
  expect(await client.list()).toEqual([entry]);
  expect(fetcher).toHaveBeenCalledWith(
    "/v1/admin/expert-verification?limit=50",
    expect.objectContaining({
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
    }),
  );
});
it("sends only exact manager authority fields and stable caller key", async () => {
  const fetcher = vi.fn(async () =>
    response({
      kind: "ok",
      applicationId: id,
      decision: "approved",
      invoiceId: id,
      replay: false,
      payment: { status: "waiting_configuration" },
    }),
  );
  const client = new ExpertVerificationClient(token, fetcher);
  await client.decide(id, "approved", "verified", "synthetic-key-123");
  const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(call[1].body))).toEqual({
    decision: "approved",
    reasonCode: "verified",
    idempotencyKey: "synthetic-key-123",
  });
});
it("recovers existing invoice without a request body", async () => {
  const fetcher = vi.fn(async () =>
    response({ kind: "ok", payment: { status: "pending" } }),
  );
  await new ExpertVerificationClient(token, fetcher).recover(id);
  expect(fetcher).toHaveBeenCalledWith(
    `/v1/admin/expert-verification/invoices/${id}/checkout`,
    expect.objectContaining({ method: "POST" }),
  );
  expect(
    (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body,
  ).toBeUndefined();
});
it.each([401, 403])("bounds authentication failure%s", async (status) => {
  const client = new ExpertVerificationClient(token, async () =>
    response({ error: "synthetic-private-prose" }, status),
  );
  await expect(client.list()).rejects.toThrow("verification_unauthorized");
});
it("rejects unbounded or malformed server facts", async () => {
  const client = new ExpertVerificationClient(token, async () =>
    response({ kind: "ok", items: [{ ...entry, priceMinor: 1.5 }] }),
  );
  await expect(client.list()).rejects.toThrow("verification_invalid_response");
});
it("rejects unsafe checkout URLs", async () => {
  const client = new ExpertVerificationClient(token, async () =>
    response({
      kind: "ok",
      payment: {
        status: "ready",
        url: "https://untrusted.invalid/",
        paymentId: "synthetic",
      },
    }),
  );
  await expect(client.recover(id)).rejects.toThrow(
    "verification_invalid_response",
  );
});
it("clears and aborts its session instead of retaining access", async () => {
  const fetcher = vi.fn(async () => response({ kind: "ok", items: [] }));
  const client = new ExpertVerificationClient(token, fetcher);
  client.clear();
  await expect(client.list()).rejects.toThrow("verification_unauthorized");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { decision: "rejected", invoiceId: null },
  { decision: "approved", invoiceId: null },
])(
  "rejects a contradictory decision or missing approved invoice %j",
  async (value) => {
    const client = new ExpertVerificationClient(token, async () =>
      response({ kind: "ok", applicationId: id, ...value, replay: false }),
    );
    await expect(
      client.decide(id, "approved", "verified", "synthetic-key-123"),
    ).rejects.toThrow("verification_invalid_response");
  },
);
