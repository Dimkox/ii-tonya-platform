import { expect, it, vi } from "vitest";
import { EarlyBirdDeferredAuthority } from "./expert-early-bird-deferred-authority.js";

it("issues separate stage invoices only for the authenticated current scope and records the pay click", async () => {
  const userId = crypto.randomUUID(),
    offerId = crypto.randomUUID(),
    choiceId = crypto.randomUUID(),
    accountId = crypto.randomUUID();
  const identity = {
    botId: "bot",
    botKey: "bot",
    telegramUserId: "1",
    chatId: "1",
    updateId: 1,
    text: "",
  };
  const scope = { ...identity, offerId, choiceId, accountId, revision: 2 };
  const payments = {
    prepare: vi.fn(),
    invoice: vi.fn(async ({ stage }: { stage: string }) =>
      stage === "onboarding" ? 1000n : 2000n,
    ),
  };
  const engagement = { recordEngagementForUser: vi.fn() };
  const authority = new EarlyBirdDeferredAuthority({
    scope: {
      resolveCurrent: async () => scope,
      resolve: async () => ({ userId }),
      resolveQualified: async () => ({
        userId,
        baseId: offerId,
        choiceId,
        configId: crypto.randomUUID(),
      }),
    } as never,
    contacts: {
      active: async () => ({ id: crypto.randomUUID() }),
      capture: async () => ({
        id: crypto.randomUUID(),
        expiresAt: "2027-01-01T00:00:00Z",
      }),
    } as never,
    payments: payments as never,
    checkout: {
      checkout: async () => ({
        kind: "ready",
        confirmationUrl: "https://yoomoney.ru/pay",
      }),
    } as never,
    status: {
      current: async () => ({
        id: offerId,
        revision: 2,
        status: "ONBOARDING_ONLY",
        baseMonthlyMinor: "2000",
      }),
    } as never,
    engagement,
    identityKey: Buffer.alloc(32, 3),
    clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
  });
  const base = { ...identity, offerId, revision: 2 };
  await authority.prepare({ ...base, choice: "later", choiceId });
  await authority.prepare({ ...base, choice: "later", choiceId });
  expect(payments.prepare.mock.calls[0]![0].accountId).toBe(
    payments.prepare.mock.calls[1]![0].accountId,
  );
  const onboarding = await authority.choose({ ...base, choice: "later" });
  expect(onboarding).toMatchObject({
    kind: "invoice",
    purpose: "onboarding",
    totalMinor: "1000",
    subscriptionMinor: "0",
  });
  const subscription = await authority.choose({
    ...base,
    choice: "subscription",
  });
  expect(subscription).toMatchObject({
    kind: "invoice",
    purpose: "subscription",
    totalMinor: "2000",
    onboardingMinor: "0",
  });
  expect(engagement.recordEngagementForUser).toHaveBeenCalledWith(userId);
  expect(
    await authority.choose({
      ...base,
      offerId: crypto.randomUUID(),
      choice: "subscription",
    }),
  ).toBeNull();
  expect(
    await authority.captureReceipt(identity, "test@example.org"),
  ).toMatchObject({
    kind: "invoice",
    purpose: "subscription",
    totalMinor: "2000",
  });
  expect(payments.invoice).toHaveBeenCalledTimes(3);
});
