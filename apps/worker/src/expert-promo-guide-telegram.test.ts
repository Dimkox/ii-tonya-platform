import { describe, expect, it, vi } from "vitest";
import { createExpertPromoGuideTelegramTransport } from "./expert-promo-guide-telegram.js";
const token = `123:${"a".repeat(30)}`;
describe("WAIT-T03 guide transport", () => {
  it("sends one document and returns the message id", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ ok: true, result: { message_id: 7 } }),
    );
    const t = createExpertPromoGuideTelegramTransport({ token, fetch });
    await expect(
      t.sendDocument({ chatId: "42", document: "FILEID", caption: "c" }),
    ).resolves.toEqual({ messageId: "7" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("treats a Telegram error as uncertain", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ ok: false }, { status: 400 }),
    );
    const t = createExpertPromoGuideTelegramTransport({ token, fetch });
    await expect(
      t.sendDocument({ chatId: "42", document: "FILEID", caption: "c" }),
    ).rejects.toThrow("expert_promo_guide_delivery_uncertain");
  });
});
