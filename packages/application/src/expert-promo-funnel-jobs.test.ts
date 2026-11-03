import { describe, expect, it, vi } from "vitest";
import { runExpertPromoGuideDelivery } from "./expert-promo-funnel-jobs.js";
const ports = (send = vi.fn(async () => ({ messageId: "9" }))) => ({
  claimGuideDeliveries: vi.fn(async () => [{ userId: "u", chatId: "1" }]),
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
});
import { runExpertPromoFunnelTimers } from "./expert-promo-funnel-jobs.js";
describe("WAIT-T04 funnel timers", () => {
  it("sends each claimed timer once and counts failures", async () => {
    const claimTimer = vi.fn(async ({ kind }: { kind: string }) =>
      kind === "message6"
        ? [{ userId: "a", chatId: "1" }]
        : [{ userId: "b", chatId: "2" }],
    );
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("x"));
    expect(
      await runExpertPromoFunnelTimers({ claimTimer, sendMessage }),
    ).toEqual({
      message6: 1,
      gift: 0,
      failed: 1,
    });
  });
});
