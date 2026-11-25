import { describe, expect, it, vi } from "vitest";
import {
  runExpertPromoGuideDelivery,
  type ExpertPromoGuideDeliveryPorts,
} from "./expert-promo-funnel-jobs.js";
const ports = (send = vi.fn(async () => ({ messageId: "9" }))) => ({
  claimGuideDeliveries: vi.fn<
    ExpertPromoGuideDeliveryPorts["claimGuideDeliveries"]
  >(async () => [{ userId: "u", chatId: "1" }]),
  markGuideDelivered: vi.fn(async () => true),
  sendDocument: send,
});
describe("WAIT-T03 guide delivery job", () => {
  it("skips without owner content", async () => {
    const p = ports();
    expect(await runExpertPromoGuideDelivery(p, {})).toMatchObject({
      skipped: true,
    });
    expect(p.claimGuideDeliveries).not.toHaveBeenCalled();
  });
  it("sends and marks pdf_sent", async () => {
    const p = ports();
    expect(await runExpertPromoGuideDelivery(p, { document: "F" })).toEqual({
      delivered: 1,
      failed: 0,
      skipped: false,
    });
    expect(p.markGuideDelivered).toHaveBeenCalledWith({
      userId: "u",
      receipt: "telegram:9",
    });
  });
  it("does not mark on transport failure", async () => {
    const p = ports(
      vi.fn(async () => {
        throw new Error("x");
      }),
    );
    expect(
      await runExpertPromoGuideDelivery(p, { document: "F" }),
    ).toMatchObject({ failed: 1 });
    expect(p.markGuideDelivered).not.toHaveBeenCalled();
  });
  it("sends the courtesy PDF without claiming two referrals", async () => {
    const p = ports();
    p.claimGuideDeliveries.mockResolvedValue([
      { userId: "u", chatId: "1", courtesy: true },
    ]);
    await runExpertPromoGuideDelivery(p, { document: "test-guide" });
    expect(p.sendDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        document: "test-guide",
        caption: expect.not.stringContaining("Двое коллег"),
      }),
    );
  });
});
import { runExpertPromoFunnelTimers } from "./expert-promo-funnel-jobs.js";
describe("WAIT-T04 funnel timers", () => {
  it("sends each claimed timer once and counts failures", async () => {
    const claimTimer = vi.fn(async ({ kind }: { kind: string }) =>
      kind === "message6"
        ? [{ userId: "a", chatId: "1", refCode: "REF_A", referralCount: 0 }]
        : [{ userId: "b", chatId: "2", refCode: "REF_B", referralCount: 1 }],
    );
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ messageId: "65" })
      .mockRejectedValueOnce(new Error("x"));
    const confirmFirstReminder = vi.fn(async () => true);
    expect(
      await runExpertPromoFunnelTimers({
        claimTimer,
        sendMessage,
        confirmFirstReminder,
      }),
    ).toEqual({
      message6: 1,
      gift: 0,
      failed: 1,
    });
    expect(confirmFirstReminder).toHaveBeenCalledExactlyOnceWith({
      userId: "a",
      messageId: "65",
    });
  });
  it("only confirms a successful text send, even when the banner succeeded", async () => {
    const confirmFirstReminder = vi.fn(async () => true);
    const result = await runExpertPromoFunnelTimers(
      {
        claimTimer: async ({ kind }) =>
          kind === "message6"
            ? [{ userId: "u", chatId: "1", refCode: "REF_U", referralCount: 0 }]
            : [],
        sendPhoto: async () => ({ messageId: "90" }),
        sendMessage: async () => {
          throw new Error("unknown outcome");
        },
        confirmFirstReminder,
      },
      { banner: "synthetic-banner" },
    );
    expect(confirmFirstReminder).not.toHaveBeenCalled();
    expect(result).toEqual({ message6: 0, gift: 0, failed: 1 });
  });
});
import { runExpertPromoCrmSync } from "./expert-promo-funnel-jobs.js";
describe("WAIT-T06 CRM sync", () => {
  const contact = {
    userId: "u",
    firstName: "Аня",
    gender: "female" as const,
    status: "REFERRAL_ACTIVE",
    referralCount: 1,
  };
  it("is disabled by default and makes no calls", async () => {
    const crm = { upsertContact: vi.fn() };
    const listCrmDue = vi.fn(async () => [contact]);
    expect(
      await runExpertPromoCrmSync({ listCrmDue, markCrmSynced: vi.fn(), crm }),
    ).toMatchObject({ skipped: true });
    expect(listCrmDue).not.toHaveBeenCalled();
    expect(crm.upsertContact).not.toHaveBeenCalled();
  });
  it("syncs and marks when enabled", async () => {
    const crm = { upsertContact: vi.fn(async () => {}) };
    const markCrmSynced = vi.fn(async () => true);
    expect(
      await runExpertPromoCrmSync(
        { listCrmDue: async () => [contact], markCrmSynced, crm },
        { enabled: true },
      ),
    ).toEqual({ synced: 1, failed: 0, skipped: false });
    expect(markCrmSynced).toHaveBeenCalledWith({
      userId: "u",
      referralCount: 1,
    });
  });
});

describe("WAIT-v4 timers", () => {
  it("renders current referral counts and opt-out buttons", async () => {
    const sendMessage = vi.fn(async () => ({ messageId: "1" }));
    const p = {
      confirmFirstReminder: vi.fn(async () => true),
      claimTimer: vi.fn(async () => [
        { userId: "u", chatId: "1", refCode: "REF_U", referralCount: 1 },
      ]),
      sendMessage,
    };
    await runExpertPromoFunnelTimers(p);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "Сейчас по вашему коду зарегистрировано: **1** человек",
        ),
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Осталось пригласить ещё **1**"),
      }),
    );
  });
  it("uses the approved free-guide text on the final nudge", async () => {
    const sendMessage = vi.fn(async () => ({ messageId: "1" }));
    const p = {
      confirmFirstReminder: vi.fn(async () => true),
      claimTimer: vi.fn(async ({ kind }: { kind: string }) =>
        kind === "gift"
          ? [
              {
                userId: "abcdef01-2345-4567-89ab-cdef01234567",
                chatId: "1",
                refCode: "promo_1234567890abcdef1234567890abcdef",
                referralCount: 0,
              },
            ]
          : [],
      ),
      sendMessage,
    };
    await runExpertPromoFunnelTimers(p);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "решили просто подарить вам наш главный гид",
        ),
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("REF_ABCDEF012345"),
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        replyMarkup: {
          inline_keyboard: [
            [{ text: "Скачать PDF", callback_data: "wl:guide" }],
          ],
        },
      }),
    );
  });
  it("sends an optional gift banner before reminders", async () => {
    const sendMessage = vi.fn(async () => ({ messageId: "1" }));
    const sendPhoto = vi.fn(async () => ({}));
    const p = {
      confirmFirstReminder: vi.fn(async () => true),
      claimTimer: vi.fn(async () => [
        { userId: "u", chatId: "1", refCode: "REF_U", referralCount: 0 },
      ]),
      sendMessage,
      sendPhoto,
    };
    await runExpertPromoFunnelTimers(p, { banner: "PHOTO_ID" });
    expect(sendPhoto).toHaveBeenCalledTimes(2);
  });
});
