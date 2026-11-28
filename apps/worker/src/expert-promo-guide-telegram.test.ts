import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnv } from "@ii-tonya/config";
import {
  PostgresExpertPromoFunnelRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import { createExpertApplicantComposition } from "../../api/src/expert-applicant-composition.js";
import { createExpertPromoFunnelRunner } from "./expert-promo-funnel-composition.js";
import { createExpertPromoGuideTelegramTransport } from "./expert-promo-guide-telegram.js";
import * as localAssets from "./expert-promo-local-assets.js";

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

describe("WAIT-T03 guide availability", () => {
  afterEach(() => vi.restoreAllMocks());

  const env = {
    DATABASE_URL: "postgresql://localhost/test",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    WAITLIST_FUNNEL_V4_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: "717171",
    EXPERT_PROMO_TELEGRAM_BOT_KEY: "fixture-promo",
    EXPERT_PROMO_TELEGRAM_BOT_TOKEN: "717171:" + "x".repeat(35),
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: "synthetic_".repeat(4),
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
    EXPERT_PROMO_GIFT_BANNER_FILE_ID: "fixture_banner",
  };
  const target = {
    userId: "b0000000-1234-4000-8000-000000000001",
    chatId: "42",
    refCode: "promo_" + "a".repeat(32),
    referralCount: 1,
  };
  async function exercise(selector?: string) {
    const config = loadEnv({
      ...env,
      ...(selector === undefined
        ? {}
        : { EXPERT_PROMO_GUIDE_FILE_ID: selector }),
    });
    const repo = PostgresExpertPromoFunnelRepository.prototype;
    const timer = vi.spyOn(repo, "claimTimer").mockResolvedValue([target]);
    const confirm = vi
      .spyOn(repo, "confirmFirstReminder")
      .mockResolvedValue(true);
    const claim = vi
      .spyOn(repo, "claimGuideDeliveries")
      .mockResolvedValue([target]);
    const mark = vi.spyOn(repo, "markGuideDelivered").mockResolvedValue(true);
    const request = vi
      .spyOn(repo, "requestOfferedGuide")
      .mockResolvedValue("queued");
    const sent: { method: string; body: RequestInit["body"] }[] = [];
    const db = {} as DrizzleDb;
    const worker = createExpertPromoFunnelRunner(
      db,
      config,
      async (url, init) => {
        sent.push({ method: String(url).split("/").at(-1)!, body: init?.body });
        return Response.json({ ok: true, result: { message_id: 1 } });
      },
    )!;
    const reply = await createExpertApplicantComposition(
      db,
      config,
    )!.service.handle({
      botId: env.EXPERT_PROMO_TELEGRAM_BOT_ID,
      botKey: env.EXPERT_PROMO_TELEGRAM_BOT_KEY,
      telegramUserId: target.chatId,
      chatId: target.chatId,
      updateId: 1,
      text: "",
      callbackData: "wl:guide",
    });
    return {
      result: await worker.runOnce(),
      worker,
      reply,
      sent,
      timer,
      confirm,
      claim,
      mark,
      request,
    };
  }

  it("verifies the private presentation before claiming and uploads its exact bytes to the claimed chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "expert-presentation-"));
    const path = join(dir, "presentation.pdf");
    const bytes = Buffer.from("%PDF-1.7\nsynthetic approved presentation\n");
    const selector = "local:expert-promo-presentation-v1";
    const createReader = localAssets.createApprovedGuideReader;
    try {
      vi.spyOn(localAssets, "createApprovedGuideReader").mockImplementation(
        (asset) => {
          expect(asset).toMatchObject({
            slot: selector,
            path: "/etc/ii-tonya/guides/expert-promo-presentation-v1.pdf",
            sha256:
              "5529ab01650f9c4d331c8e348a601ba5d688715268c05f84b29b25630c5f9e15",
            size: 5963385,
          });
          return createReader({
            ...asset,
            path,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
        },
      );
      const { result, reply, sent, timer, claim, mark, worker } =
        await exercise(selector);
      expect(reply).toEqual({
        status: "handled",
        text: "Запрос на гайд принят.",
      });
      expect(result.guide.skipped).toBe(true);
      expect(claim).not.toHaveBeenCalled();
      expect(timer.mock.calls.map(([{ kind }]) => kind)).toEqual(["message6"]);
      await writeFile(path, Buffer.alloc(bytes.length, 65));
      expect((await worker.runOnce()).guide.skipped).toBe(true);
      expect(claim).not.toHaveBeenCalled();
      expect(mark).not.toHaveBeenCalled();
      expect(sent.every(({ method }) => method === "sendMessage")).toBe(true);

      await writeFile(path, bytes);
      expect((await worker.runOnce()).guide.delivered).toBe(1);
      expect(claim).toHaveBeenCalledWith({ contentSlot: selector, limit: 20 });
      const docs = sent.filter(({ method }) => method === "sendDocument");
      expect(docs).toHaveLength(1);
      const body = docs[0]!.body as FormData;
      expect(body.get("chat_id")).toBe(target.chatId);
      const file = body.get("document") as File;
      expect(file.name).toBe("Презентация сервиса ии-Тоня.pdf");
      expect(file.type).toBe("application/pdf");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
      expect(mark).toHaveBeenCalledWith({
        userId: target.userId,
        receipt: "telegram:1",
      });

      await writeFile(path, Buffer.alloc(bytes.length, 66));
      expect((await worker.runOnce()).guide.skipped).toBe(true);
      expect(claim).toHaveBeenCalledTimes(1);
      expect(mark).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([undefined, "", "  "])(
    "keeps referrals running and holds PDF work when the guide selector is %j",
    async (selector) => {
      const { result, reply, sent, timer, confirm, claim, mark, request } =
        await exercise(selector);
      expect(reply).toEqual({
        status: "handled",
        text: "Сейчас гайд недоступен.",
      });
      expect(request).not.toHaveBeenCalled();
      expect(result.guide).toEqual({ delivered: 0, failed: 0, skipped: true });
      expect(claim).not.toHaveBeenCalled();
      expect(mark).not.toHaveBeenCalled();
      expect(timer.mock.calls.map(([{ kind }]) => kind)).toEqual(["message6"]);
      expect(confirm).toHaveBeenCalledOnce();
      expect(sent.map(({ method }) => method)).toEqual(["sendMessage"]);
      const reminder = JSON.parse(String(sent[0]!.body));
      expect(reminder.text).toContain("**1**");
      expect(reminder.text).not.toContain("автоматически пришлет");
      expect(reminder.reply_markup.inline_keyboard.flat()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ callback_data: "wl:materials" }),
          expect.objectContaining({ callback_data: "wl:optout" }),
        ]),
      );
    },
  );

  it.each(["fixture_pdf", "local:warm-clients-guide-v1"])(
    "delivers the explicitly selected guide %s with a Telegram receipt",
    async (selector) => {
      const { result, reply, sent, timer, claim, mark } =
        await exercise(selector);
      expect(reply).toEqual({
        status: "handled",
        text: "Запрос на гайд принят.",
      });
      expect(timer.mock.calls.map(([{ kind }]) => kind)).toEqual([
        "message6",
        "gift",
      ]);
      expect(claim).toHaveBeenCalledWith({ contentSlot: selector, limit: 20 });
      expect(sent.filter(({ method }) => method === "sendPhoto")).toHaveLength(
        2,
      );
      const documents = sent.filter(({ method }) => method === "sendDocument");
      expect(documents).toHaveLength(1);
      const body = documents[0]!.body;
      if (selector === "fixture_pdf")
        expect(JSON.parse(String(body)).document).toBe(selector);
      else expect((body as FormData).get("document")).toBeInstanceOf(File);
      expect(mark).toHaveBeenCalledWith({
        userId: target.userId,
        receipt: "telegram:1",
      });
      expect(result.guide).toEqual({ delivered: 1, failed: 0, skipped: false });
    },
  );
});
