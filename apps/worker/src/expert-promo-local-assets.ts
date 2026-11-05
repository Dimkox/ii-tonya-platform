import { readFile } from "node:fs/promises";

export const EXPERT_PROMO_LOCAL_ASSETS = {
  guide: {
    slot: "local:warm-clients-guide-v1",
    path: new URL("../assets/waitlist/warm-clients-guide.pdf", import.meta.url),
    filename: "ii-tonya-warm-clients-guide.pdf",
    contentType: "application/pdf",
  },
  banner: {
    slot: "local:gift-banner-v1",
    path: new URL("../assets/waitlist/gift-banner.png", import.meta.url),
    filename: "ii-tonya-gift-banner.png",
    contentType: "image/png",
  },
} as const;

/** Telegram accepts multipart uploads, so production needs no public asset URL. */
export async function telegramAssetForm(input: {
  chatId: string;
  field: "photo" | "document";
  path: URL;
  filename: string;
  contentType: string;
  caption?: string;
}): Promise<FormData> {
  const bytes = await readFile(input.path);
  const form = new FormData();
  form.set("chat_id", input.chatId);
  form.set(
    input.field,
    new Blob([bytes], { type: input.contentType }),
    input.filename,
  );
  if (input.caption) form.set("caption", input.caption);
  return form;
}
