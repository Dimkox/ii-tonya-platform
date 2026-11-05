import { describe, expect, it } from "vitest";
import {
  EXPERT_PROMO_LOCAL_ASSETS,
  telegramAssetForm,
} from "./expert-promo-local-assets.js";

describe("bundled waitlist gifts", () => {
  it("uploads the real PDF without a token, public URL, or file_id", async () => {
    const form = await telegramAssetForm({
      chatId: "123",
      field: "document",
      caption: "Ваш гид",
      ...EXPERT_PROMO_LOCAL_ASSETS.guide,
    });
    expect(form.get("chat_id")).toBe("123");
    expect(form.get("caption")).toBe("Ваш гид");
    const file = form.get("document");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("ii-tonya-warm-clients-guide.pdf");
    expect((file as File).type).toBe("application/pdf");
    expect((file as File).size).toBeGreaterThan(100_000);
    expect(
      new Uint8Array(await (file as File).arrayBuffer()).slice(0, 4),
    ).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("bundles a Telegram-sized 16:9 PNG banner", async () => {
    const bytes = await import("node:fs/promises").then(({ readFile }) =>
      readFile(EXPERT_PROMO_LOCAL_ASSETS.banner.path),
    );
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1600);
    expect(bytes.readUInt32BE(20)).toBe(900);
  });
});
