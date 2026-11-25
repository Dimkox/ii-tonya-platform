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
