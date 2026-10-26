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
it("reverifies exactly the displayed revision on the owned application endpoint", async () => {
  const fetcher = vi.fn(async () =>
    response({ kind: "ok", applicationId: id, revision: 3 }),
  );
  const client = new ExpertVerificationClient(token, fetcher);
  await client.reverifyProfile(id, 3);
  expect(fetcher).toHaveBeenCalledWith(
    `/v1/admin/expert-verification/${id}/profile-verification`,
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ revision: 3 }),
    }),
  );
});
it("reads real submitted questionnaires and confirms exactly the returned preview hash", async () => {
  const calls: unknown[] = [];
  const hash = "a".repeat(64);
  const fetcher = vi.fn(
    async (url: RequestInfo | URL, options?: RequestInit) => {
      calls.push({ url, options });
      return response({
        kind: "ok",
        item: String(url).endsWith("review-preview")
          ? {
              previewId: id,
              text: "Здравствуйте!",
              hash,
              expiresAt: "2026-10-26T11:00:00Z",
            }
          : String(url).endsWith("review-confirm")
            ? { eventId: id, action: "APPROVED_BASIC", replay: false }
            : {
                ...entry,
                userId: id,
                contact: [],
                questionnaire: {
                  status: "submitted",
                  draft: {
                    roles: ["EXPERT"],
                    motivation: "<script>private</script>",
                  },
                  submittedRevision: 2,
                  formVersion: 2,
                  revision: 4,
                  generation: 2,
                  lifecycle: "UNDER_REVIEW",
                  supplements: null,
                },
              },
      });
    },
  );
  const client = new ExpertVerificationClient(token, fetcher);
  expect((await client.detail(id)).questionnaire.status).toBe("submitted");
  const preview = await client.previewReview(id, {
    key: "APPROVED_BASIC",
    expectedRevision: 4,
    expectedGeneration: 2,
  });
  await client.confirmReview(id, preview.previewId, preview.hash);
  expect(fetcher).toHaveBeenLastCalledWith(
    `/v1/admin/expert-verification/${id}/review-confirm`,
    expect.objectContaining({
      body: JSON.stringify({ previewId: id, finalHash: hash }),
      credentials: "omit",
      cache: "no-store",
    }),
  );
});
it("refuses stale confirmation and retries the same preview without inventing success", async () => {
  let attempt = 0;
  const bodies: string[] = [];
  const client = new ExpertVerificationClient(token, async (_url, options) => {
    bodies.push(String(options?.body));
    attempt++;
    return attempt === 1
      ? response({ error: "unavailable" }, 503)
      : response({
          kind: "ok",
          item: { eventId: id, action: "REJECT_SOFT", replay: true },
        });
  });
  await expect(client.confirmReview(id, id, "a".repeat(64))).rejects.toThrow();
  expect((await client.confirmReview(id, id, "a".repeat(64))).replay).toBe(
    true,
  );
  expect(bodies[0]).toBe(bodies[1]);
});
