import { expect, it, vi } from "vitest";
import { createExpertCardClient } from "./expert-card-client.js";
import { ExpertVerificationClient } from "./expert-verification-client.js";
const id = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const workflow = {
  applicationId: id,
  draftId: id,
  revision: 3,
  status: "approved",
  entryCount: 1,
  materialStatus: "delivered",
  promoConfirmed: false,
};
const publicCard = {
  displayName: "Эксперт",
  profession: "Коуч",
  city: "Москва",
  summary: "Профессиональное описание",
};
const item = {
  ...workflow,
  entries: [
    {
      id,
      kind: "text",
      text: "Private raw text",
      reference: null,
      revision: 3,
    },
  ],
  publicCard,
  approvedReviewId: reviewId,
  materials: { jobId: id, status: "delivered", contentVersion: "v1" },
  promoProofs: [
    {
      id,
      kind: "link",
      reference: "https://example.test/proof",
      revision: 3,
      reviewId,
    },
  ],
};
it("decodes the dedicated card queue and protected raw draft", async () => {
  const request = vi.fn(async (path: string) =>
    path.startsWith("?")
      ? { kind: "ok", items: [workflow] }
      : { kind: "ok", item },
  );
  const client = createExpertCardClient(request);
  expect(await client.list()).toEqual([workflow]);
  expect(await client.read(id)).toEqual(item);
  expect(request.mock.calls.map((c) => c[0])).toEqual(["?limit=50", `/${id}`]);
});
it("sends public-only editable fields with immutable expected revision", async () => {
  const request = vi.fn(async () => ({
    kind: "ok",
    item: { ...workflow, revision: 4, status: "manager_review", replay: false },
  }));
  await createExpertCardClient(request).edit(id, {
    expectedRevision: 3,
    publicCard,
    idempotencyKey: "synthetic-key-123",
  });
  expect(request).toHaveBeenCalledWith(`/${id}/public-card`, {
    expectedRevision: 3,
    publicCard,
    idempotencyKey: "synthetic-key-123",
  });
});
it("review and promo actions cannot set sent/paid/active facts", async () => {
  const request = vi.fn(async () => ({
    kind: "ok",
    item: { ...workflow, replay: false },
  }));
  const client = createExpertCardClient(request);
  await client.review(id, {
    expectedRevision: 3,
    action: "approve",
    idempotencyKey: "synthetic-key-123",
  });
  await client.confirmPromo(id, {
    expectedRevision: 3,
    idempotencyKey: "synthetic-key-456",
  });
  expect(request).toHaveBeenNthCalledWith(1, `/${id}/review`, {
    expectedRevision: 3,
    action: "approve",
    idempotencyKey: "synthetic-key-123",
  });
  expect(request).toHaveBeenNthCalledWith(2, `/${id}/promo-review`, {
    expectedRevision: 3,
    idempotencyKey: "synthetic-key-456",
  });
});
it("rejects wrong-owner or wrong-revision response snapshots", async () => {
  const request = vi.fn(async () => ({
    kind: "ok",
    item: { ...item, applicationId: reviewId },
  }));
  await expect(createExpertCardClient(request).read(id)).rejects.toThrow(
    "verification_invalid_response",
  );
});
it("rejects overbounded private references and malformed public fields", async () => {
  const request = vi.fn(async () => ({
    kind: "ok",
    item: {
      ...item,
      entries: [{ ...item.entries[0], text: "x".repeat(4001) }],
    },
  }));
  await expect(createExpertCardClient(request).read(id)).rejects.toThrow(
    "verification_invalid_response",
  );
});
it("shares existing memory-only token, no-store transport and logout cancellation", async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ kind: "ok", items: [workflow] })),
  );
  const staff = new ExpertVerificationClient(
    "synthetic-session-token-1234567890",
    fetcher,
  );
  await staff.cards.list();
  expect(fetcher).toHaveBeenCalledWith(
    "/v1/admin/expert-cards?limit=50",
    expect.objectContaining({
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: expect.objectContaining({
        authorization: "Bearer synthetic-session-token-1234567890",
      }),
    }),
  );
  staff.clear();
  await expect(staff.cards.list()).rejects.toThrow("verification_unauthorized");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects caller-supplied publication authority before HTTP", async () => {
  const request = vi.fn(async () => ({ kind: "ok", item: workflow }));
  await expect(
    createExpertCardClient(request).confirmPromo(id, {
      expectedRevision: 3,
      idempotencyKey: "synthetic-key-123",
      sent: true,
    } as never),
  ).rejects.toThrow("verification_invalid_response");
  expect(request).not.toHaveBeenCalled();
});

it("retains explicit unknown delivery outcome without pretending it was delivered", async () => {
  const request = vi.fn(async () => ({
    kind: "ok",
    item: {
      ...item,
      materialStatus: "unknown_outcome",
      materials: { jobId: id, status: "unknown_outcome", contentVersion: "v1" },
    },
  }));
  expect(await createExpertCardClient(request).read(id)).toMatchObject({
    materialStatus: "unknown_outcome",
    materials: { status: "unknown_outcome" },
  });
});

it("captures the submitted revision before awaiting transport", async () => {
  const input = {
    expectedRevision: 3,
    publicCard: { ...publicCard },
    idempotencyKey: "synthetic-key-123",
  };
  const request = vi.fn(async () => {
    input.expectedRevision = 99;
    return {
      kind: "ok",
      item: {
        ...workflow,
        revision: 4,
        status: "manager_review",
        replay: false,
      },
    };
  });
  expect(await createExpertCardClient(request).edit(id, input)).toMatchObject({
    revision: 4,
  });
});

it("does not accept an edit acknowledgement that fails to advance its revision", async () => {
  const request = vi.fn(async () => ({
    kind: "ok",
    item: { ...workflow, replay: false },
  }));
  await expect(
    createExpertCardClient(request).edit(id, {
      expectedRevision: 3,
      publicCard,
      idempotencyKey: "synthetic-key-123",
    }),
  ).rejects.toThrow("verification_invalid_response");
});

it.each(["edit", "review"] as const)(
  "R4 rejects committed %s refusals with private field reasons",
  async (operation) => {
    const client = createExpertCardClient(async () => ({
      kind: "ok",
      item: {
        ...workflow,
        status: "manager_review",
        replay: false,
        safetyBlocked: true,
        safetyIssues: [
          {
            field: "public:summary",
            ruleId: id,
            severity: "BLOCKER",
            reason: "Уберите обещание лечения.",
          },
        ],
      },
    }));
    const command = {
      expectedRevision: 3,
      idempotencyKey: "safety-refusal-001",
    };
    const result =
      operation === "edit"
        ? client.edit(id, { ...command, publicCard })
        : client.review(id, { ...command, action: "approve" });
    await expect(result).rejects.toThrow(
      "card_safety_blocked:public:summary: Уберите обещание лечения.",
    );
  },
);

it("bounds and validates current and approved media independently", async () => {
  const media = [{ id, state: "verified" }];
  const read = (previousMedia: unknown) =>
    createExpertCardClient(async () => ({
      kind: "ok",
      item: { ...item, media, previousMedia },
    })).read(id);
  expect(await read([{ id: reviewId, state: "unavailable" }])).toMatchObject({
    media,
    previousMedia: [{ id: reviewId, state: "unavailable" }],
  });
  for (const malformed of [
    [{ id: "not-an-id", state: "verified" }],
    [{ id, state: "public" }],
    Array(11).fill(media[0]),
  ]) {
    await expect(read(malformed)).rejects.toThrow(
      "verification_invalid_response",
    );
  }
});
