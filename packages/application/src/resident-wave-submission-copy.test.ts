import { expect, it } from "vitest";
import {
  createResidentVerificationService,
  type ResidentFormRepository,
} from "./resident-verification-service.js";
const repository: ResidentFormRepository = {
  mutate: async () => ({
    id: "00000000-0000-4000-8000-000000000001",
    revision: 2,
    draft: {},
    status: "UNDER_REVIEW",
    progress: "MANUAL_REVIEW",
    replay: false,
  }),
};
const input = {
  botId: "1",
  botKey: "wave",
  telegramUserId: "123",
  chatId: "123",
  updateId: 1,
  text: "/verification",
};
it("wave submission retains the selected combined/later flow without claiming a separate fixed3000 fee", async () => {
  const service = createResidentVerificationService({
    enabled: true,
    salesFirst: true,
    wavePaymentFlow: true,
    repository,
  });
  const reply = await service.handle(input);
  expect(JSON.stringify(reply)).toContain("/my_tariff");
  expect(JSON.stringify(reply)).toContain("единый счёт");
  expect(JSON.stringify(reply)).toContain("позже");
  expect(JSON.stringify(reply)).not.toContain("3000");
  expect(JSON.stringify(reply)).not.toContain("отдельно выставляется");
});
it("preserves the existing non-wave sales-first submission copy", async () => {
  const service = createResidentVerificationService({
    enabled: true,
    salesFirst: true,
    repository,
  });
  expect(JSON.stringify(await service.handle(input))).toContain(
    "отдельно выставляется взнос за онбординг 3000 ₽",
  );
});
