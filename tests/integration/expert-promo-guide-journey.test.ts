import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";
import { createExpertPromoFunnelRunner } from "../../apps/worker/src/expert-promo-funnel-composition.js";
import { loadEnv } from "../../packages/config/src/env.js";
import { PostgresConsentEvidenceRepository } from "../../packages/db/src/repositories/consent-evidence-repository.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

const botId = "717171";
const user = { id: 920021, is_bot: false };
const chat = { id: user.id, type: "private" };
const env = {
  DATABASE_URL: "postgresql://localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
  EXPERT_APPLICANT_ENABLED: "true",
  WAITLIST_FUNNEL_V4_ENABLED: "true",
  EXPERT_PROMO_TELEGRAM_BOT_ID: botId,
  EXPERT_PROMO_TELEGRAM_BOT_KEY: "fixture-promo",
  EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET: "synthetic_".repeat(4),
  EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION: "client-messaging-v1",
  EXPERT_PROMO_GUIDE_FILE_ID: "fixture_pdf",
  EXPERT_PROMO_GIFT_BANNER_FILE_ID: "fixture_banner",
};
type TelegramPayload = {
  text?: string;
  chat_id: string;
  photo?: string;
  document?: string;
  reply_markup?: {
    inline_keyboard: { text: string; callback_data?: string }[][];
  };
};
function button(payload: TelegramPayload, label: string) {
  const value = payload.reply_markup?.inline_keyboard
    .flat()
    .find((b) => b.text === label)?.callback_data;
  if (!value) throw new Error(`Missing button: ${label}`);
  return value;
}

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
  await new PostgresConsentEvidenceRepository(database.db, {
    consentMutationCapability: { enabled: true },
  }).approveDocumentVersion({
    documentKey: "consent.client_messaging",
    title: "Тестовое согласие",
    body: "Согласие на получение сообщений в тестовом боте.",
    approvedBy: "test-fixture",
  });
}, 120_000);
afterAll(async () => database?.stop(), 60_000);

it("rejects unavailable invitations before enrollment and lets a direct start recover without reattribution", async () => {
  const promo = new PostgresExpertPromoRepository(database.db, {
    messagingConsentPolicyVersion: "client-messaging-v1",
  });
  const command = (id: string, refCode?: string) => ({
    botId,
    botKey: env.EXPERT_PROMO_TELEGRAM_BOT_KEY,
    chatId: id,
    telegramUserId: id,
    requestKey: randomUUID(),
    requestDigest: "b".repeat(64),
    ...(refCode ? { refCode } : {}),
  });
  const grant = async (id: string, refCode?: string) => {
    const prompt = await promo.beginEnrollment(command(id, refCode));
    if (prompt.kind !== "consent_required")
      throw new Error("missing test consent");
    await promo.completeEnrollment({
      ...command(id),
      token: prompt.token,
      decision: "granted",
    });
  };
  const newUser = "920031",
    oldCandidate = "920032",
    first = "920033",
    other = "920034";
  await expect(
    promo.beginEnrollment(command(newUser, "promo_" + "0".repeat(32))),
  ).rejects.toThrow("promo_code_unavailable");
  await grant(first);
  const owner = await promo.register(command(first));
  await grant(other);
  const second = await promo.register(command(other));
  await grant(oldCandidate, owner.refCode);
  await database.db.execute(
    sql`update users set active=false where id=${owner.userId}::uuid`,
  );
  const publicCode =
    "REF_" + owner.userId.replaceAll("-", "").slice(0, 12).toUpperCase();
  for (const unavailable of [owner.refCode, publicCode])
    await expect(
      promo.beginEnrollment(command(newUser, unavailable)),
    ).rejects.toThrow("promo_code_unavailable");
  expect(
    (
      await database.db.execute(
        sql`select id from channel_identities where external_id=${newUser}`,
      )
    ).rows,
  ).toHaveLength(0);
  await grant(newUser);
  await promo.register({ ...command(newUser), directStart: true });
  await expect(
    promo.register(command(oldCandidate, second.refCode)),
  ).rejects.toThrow("promo_attribution_locked");
  await expect(promo.register(command(oldCandidate))).rejects.toThrow(
    "promo_code_unavailable",
  );
  const recovered = await promo.register({
    ...command(oldCandidate),
    directStart: true,
  });
  await expect(
    promo.register(command(oldCandidate, second.refCode)),
  ).rejects.toThrow("promo_attribution_locked");
  expect(
    (
      await database.db.execute(
        sql`select referrer_user_id, counts_for_inviter from expert_promo_registrations where user_id=${recovered.userId}::uuid`,
      )
    ).rows,
  ).toEqual([{ referrer_user_id: null, counts_for_inviter: false }]);
});

it("delivers the five-day guide once after the recipient clicks its Telegram button", async () => {
  const config = loadEnv(env);
  const lifecycle = createDefaultLifecycle();
  lifecycle.preflight(config);
  const app = await buildApp(await lifecycle.dependencies(config, database.db));
  let updateId = 0;
  const post = async (input: { text: string } | { callback: string }) => {
    const response = await app.inject({
      method: "POST",
      url: `/v1/webhooks/telegram/expert-promo/${env.EXPERT_PROMO_TELEGRAM_BOT_KEY}`,
      headers: {
        "x-telegram-bot-api-secret-token":
          env.EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET,
      },
      payload: {
        update_id: ++updateId,
        ...("text" in input
          ? { message: { from: user, chat, text: input.text } }
          : {
              callback_query: {
                id: String(updateId),
                from: user,
                message: { from: { id: Number(botId), is_bot: true }, chat },
                data: input.callback,
              },
            }),
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json<TelegramPayload>();
  };
  const sent: { method: string; body: TelegramPayload }[] = [];
  const workerConfig = loadEnv({
    ...env,
    EXPERT_PROMO_TELEGRAM_BOT_TOKEN: `${botId}:${"x".repeat(35)}`,
  });
  const worker = createExpertPromoFunnelRunner(
    database.db,
    workerConfig,
    async (url, init) => {
      if (typeof init?.body !== "string")
        throw new Error("Expected a configured Telegram file ID");
      sent.push({
        method: String(url).split("/").at(-1)!,
        body: JSON.parse(init.body) as TelegramPayload,
      });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    },
  )!;
  try {
    const welcome = await post({ text: "/start" });
    const accepted = await post({
      callback: button(welcome, "Согласен(на), поехали"),
    });
    const offer = await post({
      callback: button(accepted, "Нет, я первый/первая"),
    });
    const materials = await post({
      callback: button(offer, "Да, дай мне промокод и текст"),
    });
    const invite = await post({
      callback: button(materials, "Вариант 1 — Информативный"),
    });
    const personalCode = invite.text?.match(/REF_[A-F0-9]{12}/u)?.[0];
    expect(personalCode).toBeDefined();
    const participant = sql`(select user_id from channel_identities where bot_key=${env.EXPERT_PROMO_TELEGRAM_BOT_KEY} and external_id=${String(user.id)})`;
    await database.db.execute(
      sql`update expert_promo_funnel_state set code_issued_at=now()-interval '8 days' where user_id=${participant}`,
    );
    expect((await worker.runOnce()).timers).toEqual({
      message6: 1,
      gift: 0,
      failed: 0,
    });
    const confirmation = await database.db.execute(sql`
      select message6_confirmed_at is not null as confirmed,
             message6_message_id::text as message_id
      from expert_promo_funnel_state where user_id=${participant}`);
    expect(confirmation.rows).toEqual([{ confirmed: true, message_id: "2" }]);
    await database.db.execute(
      sql`update expert_promo_funnel_state set
            message6_sent_at=now()-interval '5 days',
            message6_confirmed_at=now()-interval '5 days'
          where user_id=${participant}`,
    );
    expect((await worker.runOnce()).timers).toEqual({
      message6: 0,
      gift: 1,
      failed: 0,
    });
    expect(sent.map((send) => send.method)).toEqual([
      "sendPhoto",
      "sendMessage",
      "sendPhoto",
      "sendMessage",
    ]);
    const [, , banner, message] = sent;
    expect(banner!.body).toMatchObject({
      chat_id: String(user.id),
      photo: env.EXPERT_PROMO_GIFT_BANNER_FILE_ID,
    });
    expect(message!.body.text).toContain(personalCode);
    const guide = button(message!.body, "Скачать PDF");
    expect((await post({ callback: guide })).text).toBe(
      "Запрос на гайд принят.",
    );
    expect((await post({ callback: guide })).text).toBe(
      "Запрос на гайд принят.",
    );
    expect((await worker.runOnce()).guide).toMatchObject({
      delivered: 1,
      failed: 0,
    });
    expect((await post({ callback: guide })).text).toBe(
      "Гайд уже отправлен в этот чат.",
    );
    expect((await worker.runOnce()).guide).toMatchObject({
      delivered: 0,
      failed: 0,
    });
    expect(
      sent
        .filter((send) => send.method === "sendDocument")
        .map((send) => send.body),
    ).toEqual([
      expect.objectContaining({
        chat_id: String(user.id),
        document: env.EXPERT_PROMO_GUIDE_FILE_ID,
      }),
    ]);
    const result = await database.db.execute(sql`
      select w.status, w.delivery_receipt, f.status as funnel,
        (select count(*)::int from expert_promo_bonus_indications) bonuses,
        (select count(*)::int from expert_referral_ledger_entries) ledger,
        (select count(*)::int from expert_residency_orders) orders
      from expert_promo_guide_work w join expert_promo_funnel_state f using (user_id)
      where w.user_id=${participant}`);
    expect(result.rows).toEqual([
      {
        status: "delivered",
        delivery_receipt: "telegram:5",
        funnel: "WAITING_FOR_LAUNCH",
        bonuses: 0,
        ledger: 0,
        orders: 0,
      },
    ]);
  } finally {
    await app.close();
  }
});
