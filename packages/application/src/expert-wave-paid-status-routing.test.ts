import { expect, it, vi } from "vitest";
import { createExpertSeparatedSalesService } from "./expert-separated-sales-service.js";
const input = {
  botId: "1",
  botKey: "test",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "/my_tariff",
};
it("routes paid status after launch while leaving ordinary sales alone", async () => {
  const handle = vi.fn(async () => ({
    status: "handled" as const,
    text: "paid",
  }));
  const service = createExpertSeparatedSalesService({
    repository: { transition: vi.fn() },
    form: { handle: vi.fn() },
    wave: { isActive: async () => false, handle },
  });
  expect(await service.handle(input)).toMatchObject({
    status: "handled",
    text: "paid",
  });
  expect(handle).toHaveBeenCalledOnce();
});
it("falls back to legacy when no wave paid status exists", async () => {
  const transition = vi.fn(async () => null);
  const service = createExpertSeparatedSalesService({
    repository: { transition },
    form: { handle: vi.fn() },
    wave: { isActive: async () => false, handle: async () => null },
  });
  expect(await service.handle(input)).toBeNull();
  expect(transition).toHaveBeenCalledOnce();
});
