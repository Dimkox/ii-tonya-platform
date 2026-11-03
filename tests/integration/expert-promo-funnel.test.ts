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
const botKey = "promo-fixture";
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
    await promo.register(command(owner));
    const quiet = await identity();
    await promo.register(command(quiet));
    const qualified = await qualifiedOwner();
    await database.db.execute(
      sql`update expert_promo_funnel_state set code_issued_at=code_issued_at-interval '6 days',last_interaction_at=last_interaction_at where user_id in (${owner.userId}::uuid,${quiet.userId}::uuid,${qualified.userId}::uuid)`,
    );
    expect(await promo.optOutReferral(quiet)).toBe(true);
    const m6 = await funnel.claimTimer({ kind: "message6", limit: 50 });
    const ids = m6.map((r) => r.userId);
    expect(ids).toContain(owner.userId);
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
    ).toContain(owner.userId);
    expect(
      (await funnel.claimTimer({ kind: "gift", limit: 50 })).map(
        (r) => r.userId,
      ),
    ).not.toContain(owner.userId);
  });
});
