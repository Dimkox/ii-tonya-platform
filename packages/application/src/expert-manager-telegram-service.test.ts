import { expect, it, vi } from "vitest";
import { createExpertManagerTelegramService } from "./expert-manager-telegram-service.js";
const sessionHash = `sha256:${"a".repeat(64)}`;
const applicationId = "12345678-1234-4234-8234-123456789012";
const setup = (enabled = true) => {
  const repository = {
    createPairing: vi.fn().mockResolvedValue(undefined),
    pair: vi.fn().mockResolvedValue(true),
    resolveCallback: vi.fn().mockResolvedValue({
      sessionHash,
      applicationId,
      decision: "approved",
      idempotencyKey: "manager:callback",
    }),
    claimNotification: vi.fn().mockResolvedValue(null),
    finishNotification: vi.fn(),
  };
  const verification = {
    decide: vi.fn().mockResolvedValue({ kind: "ok", decision: "approved" }),
  };
  const transport = { sendMessage: vi.fn() };
  return {
    repository,
    verification,
    transport,
    service: createExpertManagerTelegramService({
      enabled,
      botId: "42",
      secret: Buffer.alloc(32, 1),
      repository,
      verification,
      transport,
    }),
  };
};
it("is disabled without touching pairing, decisions or transport", async () => {
  const s = setup(false);
  expect(await s.service.pair("123", "123", "x")).toEqual({ kind: "disabled" });
  expect(await s.service.callback("123", "123", "x")).toEqual({
    kind: "disabled",
  });
  expect(await s.service.tick()).toEqual({ sent: 0 });
  expect(s.repository.pair).not.toHaveBeenCalled();
  expect(s.verification.decide).not.toHaveBeenCalled();
});
it("rejects forged callbacks before reading or deciding", async () => {
  const s = setup();
  expect(await s.service.callback("123", "123", "mt1.forged")).toEqual({
    kind: "forbidden",
  });
  expect(s.repository.resolveCallback).not.toHaveBeenCalled();
  expect(s.verification.decide).not.toHaveBeenCalled();
});
it("rejects unpaired or expired callback without a decision", async () => {
  const s = setup();
  const token = s.service.signCallback("a".repeat(64));
  s.repository.resolveCallback.mockResolvedValue(null);
  expect(await s.service.callback("123", "123", token)).toEqual({
    kind: "forbidden",
  });
  expect(s.verification.decide).not.toHaveBeenCalled();
});
it("delegates a signed bound callback only to existing fresh-session manager authority", async () => {
  const s = setup();
  const token = s.service.signCallback("a".repeat(64));
  expect(await s.service.callback("123", "123", token)).toMatchObject({
    kind: "ok",
  });
  expect(s.repository.resolveCallback).toHaveBeenCalledWith({
    botId: "42",
    telegramUserId: "123",
    chatId: "123",
    nonceHash: "a".repeat(64),
  });
  expect(s.verification.decide).toHaveBeenCalledWith(sessionHash, {
    applicationId,
    decision: "approved",
    reasonCode: "telegram_manager_review",
    idempotencyKey: "manager:callback",
  });
});
it("does not pair a Telegram group or malformed token", async () => {
  const s = setup();
  expect(await s.service.pair("123", "456", "a".repeat(43))).toEqual({
    kind: "forbidden",
  });
  expect(s.repository.pair).not.toHaveBeenCalled();
});
it("issues a one-time opaque pairing token through the repository authority", async () => {
  const s = setup();
  const result = await s.service.createPairing(sessionHash);
  expect(result.kind).toBe("ok");
  expect(s.repository.createPairing).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionHash,
      botId: "42",
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }),
  );
});
it("sends actual queue buttons and records only an acknowledged send", async () => {
  const s = setup();
  s.repository.claimNotification.mockResolvedValueOnce({
    id: applicationId,
    fence: applicationId,
    chatId: "123",
    approveNonceHash: "a".repeat(64),
    rejectNonceHash: "b".repeat(64),
  });
  s.transport.sendMessage.mockResolvedValue({ messageId: "1" });
  expect(await s.service.tick()).toEqual({ sent: 1 });
  expect(s.transport.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      chatId: "123",
      text: "Новая заявка на проверку",
      replyMarkup: {
        inline_keyboard: [
          [
            expect.objectContaining({ text: "Одобрить" }),
            expect.objectContaining({ text: "Отклонить" }),
          ],
        ],
      },
    }),
  );
  expect(s.repository.finishNotification).toHaveBeenCalledWith(
    applicationId,
    applicationId,
    "1",
  );
});
it("does not record an ambiguous or failed transport as sent", async () => {
  const s = setup();
  s.repository.claimNotification.mockResolvedValueOnce({
    id: applicationId,
    fence: applicationId,
    chatId: "123",
    approveNonceHash: "a".repeat(64),
    rejectNonceHash: "b".repeat(64),
  });
  s.transport.sendMessage.mockRejectedValue(new Error("synthetic"));
  expect(await s.service.tick()).toEqual({ sent: 0 });
  expect(s.repository.finishNotification).not.toHaveBeenCalled();
});

it("verifies the displayed profile revision before approval and denies unavailable verification", async () => {
  const s = setup();
  s.repository.resolveCallback.mockResolvedValue({
    sessionHash,
    applicationId,
    decision: "approved",
    idempotencyKey: "manager:callback",
    profileUserId: applicationId,
    profileRevision: 2,
  });
  expect(
    await s.service.callback(
      "123",
      "123",
      s.service.signCallback("a".repeat(64)),
    ),
  ).toEqual({ kind: "unavailable" });
  expect(s.verification.decide).not.toHaveBeenCalled();
});
