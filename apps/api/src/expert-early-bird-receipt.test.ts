import { expect, it, vi } from "vitest";
import { createExpertEarlyBirdService } from "./expert-early-bird-service.js";
const input = {
  botId: "1",
  botKey: "test",
  telegramUserId: "123",
  chatId: "123",
  updateId: 42,
  text: "/receipt fixture@example.invalid",
};
const settings = {
  phase: "WAVE_1_EARLY_BIRD" as const,
  clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
  now: () => Date.parse("2026-11-02T00:00:00+03:00"),
};
const base = { present: vi.fn(), choose: vi.fn() };
it("captures the wave receipt without passing its plaintext inside the scope or echoing it", async () => {
  const captureReceipt = vi.fn(async () => true);
  const service = createExpertEarlyBirdService(
    { ...base, captureReceipt },
    settings,
  );
  const response = await service.handle(input);
  expect(captureReceipt).toHaveBeenCalledWith(
    { ...input, text: "" },
    "fixture@example.invalid",
  );
  expect(JSON.stringify(response)).not.toContain("fixture@example.invalid");
  expect(response?.status).toBe("handled");
});
it("keeps the old route available when wave receipt is not composed", async () => {
  const service = createExpertEarlyBirdService(base, settings);
  expect(await service.handle(input)).toBeNull();
});
it("shows the verified combined invoice after contact capture", async () => {
  const invoice = {
    kind: "invoice" as const,
    purpose: "combined" as const,
    url: "https://yoomoney.ru/checkout",
    totalMinor: "3000",
    onboardingMinor: "1000",
    subscriptionMinor: "2000",
    clientStart: "2027-01-10T21:00:00.000Z",
  };
  const service = createExpertEarlyBirdService(
    { ...base, captureReceipt: async () => invoice },
    settings,
  );
  const result = await service.handle(input);
  expect(result).toMatchObject({ status: "handled" });
  expect(JSON.stringify(result)).toContain("https://yoomoney.ru/checkout");
  expect(JSON.stringify(result)).not.toContain("fixture@example.invalid");
});
it("rejects a receipt invoice with an untrusted URL or altered owner amount", async () => {
  const invoice = {
    kind: "invoice" as const,
    purpose: "combined" as const,
    url: "https://example.invalid/pay",
    totalMinor: "3000",
    onboardingMinor: "1000",
    subscriptionMinor: "2000",
    clientStart: "2027-01-10T21:00:00.000Z",
  };
  const service = createExpertEarlyBirdService(
    { ...base, captureReceipt: async () => invoice },
    settings,
  );
  expect((await service.handle(input))?.status).toBe("unavailable");
  const changed = createExpertEarlyBirdService(
    {
      ...base,
      captureReceipt: async () => ({
        ...invoice,
        url: "https://yoomoney.ru/pay",
        totalMinor: "3001",
      }),
    },
    settings,
  );
  expect((await changed.handle(input))?.status).toBe("unavailable");
});
it("displays valid separate onboarding and subscription invoices", async () => {
  for (const invoice of [
    {
      kind: "invoice" as const,
      purpose: "onboarding" as const,
      url: "https://yoomoney.ru/checkout",
      totalMinor: "1000",
      onboardingMinor: "1000",
      subscriptionMinor: "0",
      clientStart: "2027-01-10T21:00:00.000Z",
    },
    {
      kind: "invoice" as const,
      purpose: "subscription" as const,
      url: "https://yoomoney.ru/checkout",
      totalMinor: "2000",
      onboardingMinor: "0",
      subscriptionMinor: "2000",
      clientStart: "2027-01-10T21:00:00.000Z",
    },
  ]) {
    const service = createExpertEarlyBirdService(
      { ...base, captureReceipt: async () => invoice },
      settings,
    );
    const result = await service.handle(input);
    expect(result?.status).toBe("handled");
    expect(JSON.stringify(result)).toContain(invoice.url);
  }
});
