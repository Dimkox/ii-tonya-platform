import { describe, expect, it, vi } from "vitest";
import { createExpertApplicantService } from "./expert-applicant-service.js";
const scope = {
  botId: "123",
  botKey: "promo",
  telegramUserId: "456",
  chatId: "456",
  updateId: 10,
};
const quoteId = "00000000-0000-4000-8000-000000000001";
function fixture(enabled = true) {
  const port = <T>(result: T) =>
    vi.fn(async (input: unknown) => {
      void input;
      return result;
    });
  const register = port({
    userId: "u",
    refCode: "promo_abcdef",
    referralCount: 2,
    bonusPoints: 100 as const,
    bonusStatus: "frozen" as const,
    guideStatus: "waiting_content" as const,
    replay: false,
  });
  const beginEnrollment = port({ kind: "ready" as const });
  const completeEnrollment = port({ kind: "granted" as const, replay: false });
  const resolve = port({ userId: "u" });
  const createApplication = port({
    applicationId: quoteId,
    userId: "u",
    quoteId,
    status: "pending" as const,
    replay: false,
  });
  const listTariffs = port({
    tariffs: [{ id: quoteId, displayName: "Synthetic approved tariff" }],
    replay: false,
  });
  const createQuote = port({
    id: quoteId,
    priceMinor: "300000",
    termMonths: 1 as const,
    expiresAt: "2026-11-01T00:00:00.000Z",
  });
  return {
    register,
    resolve,
    createApplication,
    createQuote,
    listTariffs,
    beginEnrollment,
    completeEnrollment,
    service: createExpertApplicantService({
      enabled,
      repository: {
        register,
        resolve,
        createApplication,
        createQuote,
        listTariffs,
        beginEnrollment,
        completeEnrollment,
      },
    }),
  };
}
describe("applicant private promo", () => {
  it("allocates own reusable code and parses the separate promo namespace", async () => {
    const f = fixture();
    const result = await f.service.handle({
      ...scope,
      text: "/start promo_abcdEF123",
    });
    expect(result.status).toBe("handled");
    expect(f.register).toHaveBeenCalledWith(
      expect.objectContaining({
        refCode: "promo_abcdEF123",
        requestKey: "123:10",
      }),
    );
    expect(result.text).toContain("promo_abcdef");
    expect(result.text).not.toContain("отправлен");
    expect(result.text).toContain("100");
  });
  it.each([
    "/start coupon_abc",
    "/start expert_abc",
    "/start promo_a extra",
    "/tariff x 2",
    "/apply bad",
  ])("rejects malformed or other namespaces %s", async (text) => {
    const f = fixture();
    expect((await f.service.handle({ ...scope, text })).status).toBe(
      "rejected",
    );
    expect(f.register).not.toHaveBeenCalled();
    expect(f.createQuote).not.toHaveBeenCalled();
    expect(f.createApplication).not.toHaveBeenCalled();
  });
  it.each([1, 3] as const)(
    "reuses quote authority with explicit%s-month choice",
    async (termMonths) => {
      const f = fixture();
      const result = await f.service.handle({
        ...scope,
        text: `/tariff ${quoteId} ${termMonths}`,
      });
      expect(result.status).toBe("handled");
      expect(f.createQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          botId: "123",
          telegramUserId: "456",
          tariffVersionId: quoteId,
          termMonths,
          requestKey: "123:10",
        }),
      );
    },
  );
  it("binds application through repository rather than transport user id", async () => {
    const f = fixture();
    await f.service.handle({ ...scope, text: `/apply ${quoteId}` });
    expect(f.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId,
        telegramUserId: "456",
        requestKey: "123:10",
      }),
    );
  });
  it("requires active private identity for quote", async () => {
    const f = fixture();
    f.createQuote.mockRejectedValueOnce(new Error("consent denied"));
    expect(
      (await f.service.handle({ ...scope, text: `/tariff ${quoteId} 1` }))
        .status,
    ).toBe("unavailable");
  });
  it.each([
    { ...scope, chatId: "789" },
    { ...scope, updateId: -1 },
    { ...scope, botId: "bad" },
  ])("rejects invalid scope before storage", async (input) => {
    const f = fixture();
    expect((await f.service.handle({ ...input, text: "/start" })).status).toBe(
      "rejected",
    );
    expect(f.register).not.toHaveBeenCalled();
  });
  it("defaults disabled without storage calls", async () => {
    const f = fixture(false);
    expect((await f.service.handle({ ...scope, text: "/start" })).status).toBe(
      "disabled",
    );
    expect(f.register).not.toHaveBeenCalled();
  });
  it("returns bounded failure without leaking raw storage errors", async () => {
    const f = fixture();
    f.register.mockRejectedValueOnce(new Error("secret pii"));
    expect(await f.service.handle({ ...scope, text: "/start" })).toEqual({
      status: "unavailable",
    });
  });
});

it("suppresses duplicate start delivery", async () => {
  const f = fixture();
  f.register.mockResolvedValueOnce({
    userId: "u",
    refCode: "promo_abcdef",
    referralCount: 2,
    bonusPoints: 100,
    bonusStatus: "frozen",
    guideStatus: "waiting_content",
    replay: true,
  });
  expect(await f.service.handle({ ...scope, text: "/start" })).toEqual({
    status: "duplicate",
  });
});
it("shares one command receipt namespace across actions", async () => {
  const f = fixture();
  await f.service.handle({ ...scope, text: "/start" });
  await f.service.handle({ ...scope, text: `/apply ${quoteId}` });
  expect(f.register.mock.calls[0]?.[0]).toMatchObject({ requestKey: "123:10" });
  expect(f.createApplication.mock.calls[0]?.[0]).toMatchObject({
    requestKey: "123:10",
  });
});

it("presents explicit consent before enrolling a new identity", async () => {
  const f = fixture();
  f.beginEnrollment.mockResolvedValueOnce({
    kind: "consent_required",
    token: "synthetic_token_12345678",
    policyVersion: "v1",
    document: {
      id: "doc",
      documentKey: "messaging",
      version: "1",
      textSha256: "digest",
      title: "Synthetic approved fixture",
      body: "Synthetic explicit choice",
    },
  } as never);
  const r = await f.service.handle({ ...scope, text: "/start promo_abcdefgh" });
  expect(r.status).toBe("handled");
  expect(r.text).toContain("Synthetic explicit choice");
  expect(r.text).toContain("/consent synthetic_token_12345678 granted");
  expect(f.register).not.toHaveBeenCalled();
});
it("keeps missing consent copy inactive", async () => {
  const f = fixture();
  f.beginEnrollment.mockResolvedValueOnce({ kind: "waiting_content" } as never);
  const r = await f.service.handle({ ...scope, text: "/start" });
  expect(r.text).toContain("TODO: Wait for Content Spec");
  expect(f.register).not.toHaveBeenCalled();
});
it("accepts only explicit bound consent decision", async () => {
  const f = fixture();
  const r = await f.service.handle({
    ...scope,
    text: "/consent synthetic_token_12345678 granted",
  });
  expect(r.status).toBe("handled");
  expect(f.completeEnrollment).toHaveBeenCalledWith(
    expect.objectContaining({
      token: "synthetic_token_12345678",
      decision: "granted",
      requestKey: "123:10",
    }),
  );
  expect(f.register).not.toHaveBeenCalled();
});
it("suppresses repeated consent presentation", async () => {
  const f = fixture();
  f.beginEnrollment.mockResolvedValueOnce({ kind: "consent_pending" } as never);
  expect(await f.service.handle({ ...scope, text: "/start" })).toEqual({
    status: "duplicate",
  });
});

it("captures receipt identity before consent lookup awaits", async () => {
  const f = fixture();
  const input = { ...scope, text: "/start" };
  f.beginEnrollment.mockImplementationOnce(async () => {
    input.updateId = 999;
    return { kind: "ready" };
  });
  await f.service.handle(input);
  expect(f.register).toHaveBeenCalledWith(
    expect.objectContaining({ requestKey: "123:10" }),
  );
});

it("suppresses duplicate quote delivery", async () => {
  const f = fixture();
  f.createQuote.mockResolvedValueOnce({
    id: quoteId,
    priceMinor: "300000",
    termMonths: 1,
    expiresAt: "2026-11-01T00:00:00.000Z",
    replay: true,
  } as never);
  expect(
    await f.service.handle({ ...scope, text: `/tariff ${quoteId} 1` }),
  ).toEqual({ status: "duplicate" });
});

it("shows only server-owned tariff choices and explicit1/3month commands", async () => {
  const f = fixture();
  const r = await f.service.handle({ ...scope, text: "/tariffs" });
  expect(r.status).toBe("handled");
  expect(r.text).toContain(`/tariff ${quoteId} 1`);
  expect(r.text).toContain(`/tariff ${quoteId} 3`);
  expect(f.listTariffs).toHaveBeenCalledWith(
    expect.objectContaining({ requestKey: "123:10" }),
  );
});

it("keeps oversized consent documents inactive instead of truncating legal text", async () => {
  const f = fixture();
  f.beginEnrollment.mockResolvedValueOnce({
    kind: "consent_required",
    token: "synthetic_token_12345678",
    policyVersion: "v1",
    document: {
      id: "doc",
      documentKey: "messaging",
      version: 1,
      textSha256: "digest",
      title: "Synthetic",
      body: "x".repeat(5000),
    },
  } as never);
  const r = await f.service.handle({ ...scope, text: "/start" });
  expect(r).toEqual({ status: "handled", text: "TODO: Wait for Content Spec" });
  expect(f.completeEnrollment).not.toHaveBeenCalled();
  expect(f.register).not.toHaveBeenCalled();
});
