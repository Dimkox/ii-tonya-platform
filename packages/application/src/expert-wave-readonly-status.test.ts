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
it("uses read-only paid status without a gateway", async () => {
  const read = vi.fn(async () => ({
    status: "handled" as const,
    text: "paid",
  }));
  const service = createExpertSeparatedSalesService({
    repository: { transition: vi.fn() },
    form: { handle: vi.fn() },
    paidStatus: { handle: read },
  });
  expect(await service.handle(input)).toMatchObject({
    status: "handled",
    text: "paid",
  });
  expect(read).toHaveBeenCalledWith(input);
});
it("does not call paid-status port for receipt or payment callbacks", async () => {
  const read = vi.fn(async () => null);
  const service = createExpertSeparatedSalesService({
    repository: { transition: vi.fn(async () => null) },
    form: { handle: vi.fn() },
    paidStatus: { handle: read },
  });
  await service.handle({ ...input, text: "/receipt a@example.invalid" });
  await service.handle({
    ...input,
    text: "",
    callbackData: "eb:00000000-0000-4000-8000-000000000001:1:now",
  });
  expect(read).not.toHaveBeenCalled();
});
