import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresExpertPromoFunnelRepository } from "../../packages/db/src/repositories/expert-promo-funnel-repository.js";
import { PostgresExpertPromoRepository } from "../../packages/db/src/repositories/expert-promo-repository.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";

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

describe("WAIT-011 confirmed first reminder and courtesy guide dispatch", () => {
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
