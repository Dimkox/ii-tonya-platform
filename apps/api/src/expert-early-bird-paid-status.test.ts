import { expect, it, vi } from "vitest";
import { createExpertEarlyBirdService } from "./expert-early-bird-service.js";
const input = {
  botId: "1",
  botKey: "test",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "/my_tariff",
};
const base = { present: vi.fn(), choose: vi.fn() };
const paid = {
  id: "2526c71d-803f-4c3d-9b57-74e902170001",
  revision: 1,
  status: "FULLY_PREPAID_NO_DISCOUNT" as const,
  baseMonthlyMinor: "2000",
  lockedMonthlyMinor: "2000",
  clientStart: "2027-01-10T21:00:00.000Z",
};
const start = Date.parse("2027-01-11T00:00:00+03:00");
it("shows paid waiting before launch and active after launch", async () => {
  for (const [now, residentStatus, expected] of [
    [start - 1, "ACTIVE_PAID_WAITING_START", "ожидании"],
    [start + 1, "ACTIVE", "активный резидент"],
  ] as const) {
    const service = createExpertEarlyBirdService(
      { ...base, current: async () => ({ ...paid, residentStatus }) },
      { phase: "WAVE_1_EARLY_BIRD", clientStartMs: start, now: () => now },
    );
    const result = await service.handle(input);
    expect(result).toMatchObject({ status: "handled" });
    expect(JSON.stringify(result)).toContain(expected);
  }
});
it("does not offer unpaid wave checkout after phase closes", async () => {
  const service = createExpertEarlyBirdService(
    { ...base, current: async () => ({ ...paid, status: "ONBOARDING_ONLY" }) },
    { phase: "PUBLIC_LAUNCH", clientStartMs: start, now: () => start + 1 },
  );
  expect(await service.handle(input)).toBeNull();
});
it("uses actual deferred coverage start when it differs from launch", async () => {
  const service = createExpertEarlyBirdService(
    {
      ...base,
      current: async () => ({
        ...paid,
        residentStatus: "ACTIVE_PAID_WAITING_START" as const,
        effectiveStart: "2027-01-14T21:00:00.000Z",
      }),
    },
    { phase: "WAVE_1_EARLY_BIRD", clientStartMs: start, now: () => start - 1 },
  );
  const result = await service.handle(input);
  expect(JSON.stringify(result)).toContain("15 января 2027 года");
});
