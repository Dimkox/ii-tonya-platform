import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";

export const APPROVED_PROMO_GUIDE = {
  slot: "local:expert-promo-presentation-v1",
  path: "/etc/ii-tonya/guides/expert-promo-presentation-v1.pdf",
  filename: "Презентация сервиса ии-Тоня.pdf",
  size: 5963385,
  sha256: "5529ab01650f9c4d331c8e348a601ba5d688715268c05f84b29b25630c5f9e15",
};

/** Keep only verified immutable upload bytes; the worker polls every second. */
export function createApprovedGuideReader(asset: typeof APPROVED_PROMO_GUIDE) {
  let cache: { identity: string; file: File } | undefined;
  return async (): Promise<File | undefined> => {
    const handle = await open(
      asset.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ).catch(() => undefined);
    if (!handle) return undefined;
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size !== BigInt(asset.size)) return undefined;
      const identity = [stat.dev, stat.ino, stat.ctimeNs, stat.mtimeNs].join(
        ":",
      );
      if (cache?.identity === identity) return cache.file;
      const bytes = await handle.readFile();
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
        return undefined;
      const file = new File([bytes], asset.filename, {
        type: "application/pdf",
      });
      cache = { identity, file };
      return file;
    } catch {
      return undefined;
    } finally {
      await handle.close();
    }
  };
}

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
