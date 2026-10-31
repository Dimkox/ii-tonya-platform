import { expect, it, vi } from "vitest";
import { createEarlyBirdReadOnlyStatus } from "./expert-early-bird-readonly-status.js";
const input = {
  botId: "1",
  botKey: "test",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "/my_tariff",
};
const paid = {
  id: "2526c71d-803f-4c3d-9b57-74e902170001",
  revision: 1,
  status: "FULLY_PREPAID_NO_DISCOUNT" as const,
  baseMonthlyMinor: "2000",
  lockedMonthlyMinor: "2000",
  clientStart: "2027-01-10T21:00:00.000Z",
  effectiveStart: "2027-01-10T21:00:00.000Z",
  residentStatus: "ACTIVE_PAID_WAITING_START" as const,
};
it("renders a verified waiting status without a payment capability", async () => {
  const find = vi.fn(async () => paid);
  const result = await createEarlyBirdReadOnlyStatus({ find }).handle(input);
  expect(result).toMatchObject({ status: "handled" });
  expect(JSON.stringify(result)).toContain("20 ₽");
  expect(find).toHaveBeenCalledWith({
    botId: "1",
    botKey: "test",
    telegramUserId: "123",
    chatId: "123",
  });
});
it("returns null for absent facts and refuses invalid projection fields", async () => {
  expect(
    await createEarlyBirdReadOnlyStatus({ find: async () => null }).handle(
      input,
    ),
  ).toBeNull();
  const result = await createEarlyBirdReadOnlyStatus({
    find: async () => ({ ...paid, lockedMonthlyMinor: "-1" }),
  }).handle(input);
  expect(result).toEqual({ status: "unavailable" });
});
