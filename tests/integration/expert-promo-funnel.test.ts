import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { PostgresExpertPromoFunnelRepository } from "../../packages/db/src/repositories/expert-promo-funnel-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { buildApp } from "../../apps/api/src/app.js";
import { createDefaultLifecycle } from "../../apps/api/src/server.js";
import { createExpertPromoFunnelRunner } from "../../apps/worker/src/expert-promo-funnel-composition.js";
import { loadEnv } from "../../packages/config/src/env.js";
import { PostgresConsentEvidenceRepository } from "../../packages/db/src/repositories/consent-evidence-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let database: ExpertReferralTestDatabase;
let promo: PostgresExpertPromoRepository;
let funnel: PostgresExpertPromoFunnelRepository;
let sequence = 920000;
const botKey = "promo.v4-fixture";
async function identity() {
  const userId = await database.createUser();
  const telegramUserId = String(++sequence);
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${telegramUserId},${botKey},${telegramUserId},'active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  return {
    userId,
    botKey,
    botId: "717171",
    telegramUserId,
    chatId: telegramUserId,
  };
}
const command = <T extends object>(scope: T, refCode?: string) => {
  const requestKey = randomUUID();
  return {
    ...scope,
    requestKey,
    requestDigest: createHash("sha256").update(requestKey).digest("hex"),
    ...(refCode ? { refCode } : {}),
  };
};
export async function qualifiedOwner() {
  const owner = await identity();
  const code = (await promo.register(command(owner))).refCode;
  await promo.register(command(await identity(), code));
  await promo.register(command(await identity(), code));
  return owner;
}
describe("WAIT-T03 guide delivery authority", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    promo = new PostgresExpertPromoRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    funnel = new PostgresExpertPromoFunnelRepository(database.db, {
      botKey,
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  it("claims once, marks pdf_sent and moves to WAITING_FOR_LAUNCH", async () => {
    const owner = await qualifiedOwner();
    const claimed = await funnel.claimGuideDeliveries({
      contentSlot: "guide-v1",
      limit: 50,
    });
    expect(claimed).toContainEqual({
      userId: owner.userId,
      chatId: owner.chatId,
    });
    const again = await funnel.claimGuideDeliveries({
      contentSlot: "guide-v1",
      limit: 50,
    });
    expect(again.find((r) => r.userId === owner.userId)).toBeUndefined();
    expect(await funnel.pdfSent(owner.userId)).toBe(false);
    expect(
      await funnel.markGuideDelivered({
        userId: owner.userId,
        receipt: "telegram:1",
      }),
    ).toBe(true);
    expect(
      await funnel.markGuideDelivered({
        userId: owner.userId,
        receipt: "telegram:1",
      }),
    ).toBe(false);
    expect(await funnel.pdfSent(owner.userId)).toBe(true);
    const state = (
      await database.db.execute<{ status: string }>(
        sql`select status from expert_promo_funnel_state where user_id=${owner.userId}::uuid`,
      )
    ).rows;
    expect(state).toEqual([{ status: "WAITING_FOR_LAUNCH" }]);
  });
  it("WAIT-T04 fires 48h and 5d timers once, honours opt-out and count>=2", async () => {
    const owner = await identity();
    const { refCode } = await promo.register(command(owner));
    await promo.register(command(await identity(), refCode));
    const quiet = await identity();
    await promo.register(command(quiet));
    const qualified = await qualifiedOwner();
    await database.db.execute(
      sql`update expert_promo_funnel_state set code_issued_at=code_issued_at-interval '6 days',last_interaction_at=last_interaction_at where user_id in (${owner.userId}::uuid,${quiet.userId}::uuid,${qualified.userId}::uuid)`,
    );
    expect(await promo.optOutReferral(quiet)).toBe(true);
    const m6 = await funnel.claimTimer({ kind: "message6", limit: 50 });
    const ids = m6.map((r) => r.userId);
    const expectedTarget = {
      userId: owner.userId,
      chatId: owner.chatId,
      refCode,
      referralCount: 1,
    };
    expect(m6).toContainEqual(expectedTarget);
    expect(
      await funnel.confirmFirstReminder({
        userId: owner.userId,
        messageId: "4",
      }),
    ).toBe(true);
    expect(ids).not.toContain(quiet.userId);
    expect(ids).not.toContain(qualified.userId);
    expect(
      (await funnel.claimTimer({ kind: "message6", limit: 50 })).map(
        (r) => r.userId,
      ),
    ).not.toContain(owner.userId);
    expect(
      (await funnel.claimTimer({ kind: "gift", limit: 50 })).map(
        (r) => r.userId,
      ),
    ).not.toContain(owner.userId);
    await database.db.execute(
      sql`update expert_promo_funnel_state set message6_sent_at=message6_sent_at-interval '5 days',message6_confirmed_at=message6_confirmed_at-interval '5 days' where user_id=${owner.userId}::uuid`,
    );
    expect(await funnel.claimTimer({ kind: "gift", limit: 50 })).toContainEqual(
      expectedTarget,
    );
    expect(
      (await funnel.claimTimer({ kind: "gift", limit: 50 })).map(
        (r) => r.userId,
      ),
    ).not.toContain(owner.userId);
  });
  it("WAIT-T05 records a manager question only for a registered promo user", async () => {
    const owner = await identity();
    expect(await promo.recordManagerQuestion(owner, "Вопрос")).toBe(false);
    await promo.register(command(owner));
    expect(await promo.recordManagerQuestion(owner, "Вопрос")).toBe(true);
    const rows = (
      await database.db.execute<{ status: string }>(
        sql`select status from expert_promo_manager_questions where user_id=${owner.userId}::uuid`,
      )
    ).rows;
    expect(rows).toEqual([{ status: "open" }]);
  });
  it("queues a five-day guide only for its recipient and delivers once across both reward paths", async () => {
    const owner = await identity();
    const { refCode } = await promo.register(command(owner));
    const other = await identity();
    await promo.register(command(other));
    expect(await funnel.requestOfferedGuide(owner)).toBe("unavailable");
    await database.db.execute(
      sql`update expert_promo_funnel_state set code_issued_at=now()-interval '8 days',message6_sent_at=now()-interval '6 days',message6_confirmed_at=now()-interval '6 days',message6_message_id='5',gift_sent_at=clock_timestamp() where user_id=${owner.userId}::uuid`,
    );
    expect(await funnel.requestOfferedGuide(other)).toBe("unavailable");
    expect(
      await funnel.requestOfferedGuide({ ...owner, chatId: other.chatId }),
    ).toBe("unavailable");
    expect(
      await funnel.requestOfferedGuide({ ...owner, botKey: "other-bot" }),
    ).toBe("unavailable");
    expect(
      await Promise.all([
        funnel.requestOfferedGuide(owner),
        funnel.requestOfferedGuide(owner),
      ]),
    ).toEqual(["queued", "queued"]);
    expect(await funnel.pdfSent(owner.userId)).toBe(false);
    await promo.register(command(await identity(), refCode));
    await promo.register(command(await identity(), refCode));
    const reward = (
      await database.db.execute<{ logged: boolean; earned: boolean }>(sql`
      select w.ready_log_event_id is not null as logged,
        exists(select 1 from expert_promo_bonus_indications b where b.user_id=w.user_id) as earned
      from expert_promo_guide_work w where w.user_id=${owner.userId}::uuid
    `)
    ).rows;
    expect(reward).toEqual([{ logged: true, earned: true }]);
    const claim = () =>
      funnel.claimGuideDeliveries({ contentSlot: "test-guide", limit: 50 });
    expect(await claim()).toContainEqual({
      userId: owner.userId,
      chatId: owner.chatId,
      courtesy: true,
    });
    expect((await claim()).some((t) => t.userId === owner.userId)).toBe(false);
    expect(
      await funnel.markGuideDelivered({
        userId: owner.userId,
        receipt: "telegram:5",
      }),
    ).toBe(true);
    expect(await funnel.requestOfferedGuide(owner)).toBe("delivered");
  });
  it("honours a referral opt-out between a courtesy guide request and dispatch", async () => {
    const owner = await identity();
    await promo.register(command(owner));
    await database.db.execute(
      sql`update expert_promo_funnel_state set code_issued_at=now()-interval '8 days',message6_sent_at=now()-interval '6 days',message6_confirmed_at=now()-interval '6 days',message6_message_id='5',gift_sent_at=clock_timestamp() where user_id=${owner.userId}::uuid`,
    );
    expect(await funnel.requestOfferedGuide(owner)).toBe("queued");
    await promo.optOutReferral(owner);
    expect(await funnel.requestOfferedGuide(owner)).toBe("unavailable");
    const targets = await funnel.claimGuideDeliveries({
      contentSlot: "test-guide",
      limit: 50,
    });
    expect(targets.some((t) => t.userId === owner.userId)).toBe(false);
  });
  it("WAIT-T06 stores profile fields and syncs CRM marker idempotently", async () => {
    const owner = await identity();
    await promo.register(command(owner));
    expect(await promo.saveFunnelProfile(owner, { firstName: "Аня" })).toBe(
      true,
    );
    expect(await promo.saveFunnelProfile(owner, { gender: "female" })).toBe(
      true,
    );
    const due = (await funnel.listCrmDue(100)).find(
      (r) => r.userId === owner.userId,
    );
    expect(due).toMatchObject({
      firstName: "Аня",
      gender: "female",
      referralCount: 0,
    });
    expect(
      await funnel.markCrmSynced({ userId: owner.userId, referralCount: 0 }),
    ).toBe(true);
    expect(
      await funnel.markCrmSynced({ userId: owner.userId, referralCount: 0 }),
    ).toBe(false);
    expect(
      (await funnel.listCrmDue(100)).find((r) => r.userId === owner.userId),
    ).toBeUndefined();
  });
});

describe("WAIT-011 confirmed first reminder and courtesy guide dispatch", () => {
  let database: ExpertReferralTestDatabase;
  let promo: PostgresExpertPromoRepository;
  let funnel: PostgresExpertPromoFunnelRepository;
  let sequence = 730000;
  const config = {
    botKey: "promo-receipt",
    messagingConsentPolicyVersion: "client-messaging-v1",
  };

  async function register() {
    const userId = await database.createUser();
    const telegramUserId = String(++sequence);
    const owner = {
      userId,
      botKey: config.botKey,
      botId: "717171",
      chatId: telegramUserId,
      telegramUserId,
    };
    await database.db.execute(sql`
      insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status)
      values(${userId}::uuid,'telegram',${telegramUserId},${config.botKey},${telegramUserId},'active')`);
    await seedClientConsent(database.db, userId, "client_messaging");
    await promo.register({
      ...owner,
      requestKey: `start-${telegramUserId}`,
      requestDigest: "a".repeat(64),
    });
    await database.db.execute(sql`
      update expert_promo_funnel_state set code_issued_at=now()-interval '10 days'
      where user_id=${userId}::uuid`);
    return owner;
  }

  async function claimUsers(kind: "message6" | "gift") {
    const targets = await funnel.claimTimer({ kind, limit: 50 });
    return targets.map((target) => target.userId);
  }

  async function receipt(userId: string) {
    const { rows } = await database.db.execute<{
      confirmedAt: string | null;
      messageId: string | null;
    }>(sql`
      select message6_confirmed_at::text as "confirmedAt",message6_message_id::text as "messageId"
      from expert_promo_funnel_state where user_id=${userId}::uuid`);
    return rows[0]!;
  }

  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    promo = new PostgresExpertPromoRepository(database.db, config);
    funnel = new PostgresExpertPromoFunnelRepository(database.db, config);
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);

  it("leaves a historical claim with no Telegram receipt terminal for resends and ineligible for the gift", async () => {
    const owner = await register();
    await database.db.execute(sql`
      update expert_promo_funnel_state set message6_sent_at=now()-interval '8 days'
      where user_id=${owner.userId}::uuid`);
    expect(await claimUsers("message6")).not.toContain(owner.userId);
    expect(await claimUsers("gift")).not.toContain(owner.userId);
    expect(await receipt(owner.userId)).toEqual({
      confirmedAt: null,
      messageId: null,
    });
  });

  it("records only the first text acknowledgement and never moves its timestamp on replay", async () => {
    const { userId } = await register();
    const ack = { userId, messageId: "103" };
    expect(await funnel.confirmFirstReminder(ack)).toBe(false);
    expect(await claimUsers("message6")).toContain(userId);
    expect(await claimUsers("message6")).not.toContain(userId);
    expect(await funnel.confirmFirstReminder({ userId, messageId: "0" })).toBe(
      false,
    );
    expect(await funnel.confirmFirstReminder(ack)).toBe(true);
    const first = await receipt(userId);
    expect(first).toEqual({
      confirmedAt: expect.any(String),
      messageId: ack.messageId,
    });
    expect(await funnel.confirmFirstReminder(ack)).toBe(true);
    expect(
      await funnel.confirmFirstReminder({ userId, messageId: "104" }),
    ).toBe(false);
    expect(await receipt(userId)).toEqual(first);
  });

  it("counts five days from the confirmation and still honours a later opt-out", async () => {
    const recent = await register();
    const due = await register();
    const quiet = await register();
    for (const owner of [recent, due, quiet]) {
      const delay = owner === recent ? "4 days 23 hours 55 minutes" : "5 days";
      await database.db.execute(sql`
        update expert_promo_funnel_state
        set message6_sent_at=now()-interval '8 days',
            message6_confirmed_at=now()-${delay}::interval,message6_message_id='106'
        where user_id=${owner.userId}::uuid`);
    }
    expect(await promo.optOutReferral(quiet)).toBe(true);
    const gifts = await claimUsers("gift");
    expect(gifts).not.toContain(recent.userId);
    expect(gifts).not.toContain(quiet.userId);
    expect(gifts).toContain(due.userId);
    expect(await claimUsers("gift")).not.toContain(due.userId);
  });

  it("skips a courtesy guide when opt-out commits while the worker waits on the consent subject", async () => {
    const owner = await register();
    await database.db.execute(sql`
      update expert_promo_funnel_state
      set message6_sent_at=now()-interval '8 days',
          message6_confirmed_at=now()-interval '6 days',message6_message_id='107'
      where user_id=${owner.userId}::uuid`);
    expect(await claimUsers("gift")).toContain(owner.userId);
    expect(await funnel.requestOfferedGuide(owner)).toBe("queued");
    const blocker = await database.db.$client.connect();
    let claim: ReturnType<typeof funnel.claimGuideDeliveries> | undefined;
    try {
      await blocker.query("begin");
      const { rows } = await blocker.query<{ pid: number }>(
        "select pg_backend_pid() as pid, pg_advisory_xact_lock(hashtextextended($1::uuid::text,0))",
        [owner.userId],
      );
      claim = funnel.claimGuideDeliveries({
        contentSlot: "guide-v1",
        limit: 1,
      });
      await expect
        .poll(
          async () => {
            const { rows: activity } = await database.db.$client.query<{
              waiting: boolean;
            }>(
              `select exists(select 1 from pg_stat_activity
            where datname=current_database() and wait_event='advisory'
              and $1::int=any(pg_blocking_pids(pid))) as waiting`,
              [rows[0]!.pid],
            );
            return activity[0]!.waiting;
          },
          { timeout: 5000 },
        )
        .toBe(true);
      expect(await promo.optOutReferral(owner)).toBe(true);
      await blocker.query("commit");
      expect(await claim).toEqual([]);
      const work = await database.db.execute<{ status: string }>(sql`
        select status from expert_promo_guide_work where user_id=${owner.userId}::uuid`);
      expect(work.rows).toEqual([{ status: "waiting_content" }]);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await claim;
    }
  }, 15000);
});

describe("expert promo enrollment and Telegram guide delivery", () => {
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
    const app = await buildApp(
      await lifecycle.dependencies(config, database.db),
    );
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
});
