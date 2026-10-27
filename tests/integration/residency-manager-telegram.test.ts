import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresExpertManagerTelegramRepository } from "../../packages/db/src/repositories/expert-manager-telegram-repository.js";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
let database: ExpertReferralTestDatabase;
let repo: PostgresExpertManagerTelegramRepository;
const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
async function staff(state: "fresh" | "stale" = "fresh", role = "support") {
  const userId = await database.createUser();
  const sessionHash = `sha256:${hash()}`;
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at)values(${sessionHash},${userId}::uuid,clock_timestamp()-${state === "stale" ? 20 : 0}*interval '1 minute',clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role)values(${userId}::uuid,${role})`,
  );
  return { userId, sessionHash };
}
describe("manager Telegram pairing uses original PostgreSQL authority", () => {
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    repo = new PostgresExpertManagerTelegramRepository(database.db);
  }, 120_000);
  afterAll(async () => {
    await database?.stop();
  });
  it("consumes pairing only once with exact bot/private identity binding", async () => {
    const m = await staff(),
      tokenHash = hash();
    await repo.createPairing({
      sessionHash: m.sessionHash,
      botId: "42",
      tokenHash,
    });
    expect(
      await repo.pair({
        botId: "43",
        tokenHash,
        telegramUserId: "123",
        chatId: "123",
      }),
    ).toBe(false);
    expect(
      await repo.pair({
        botId: "42",
        tokenHash,
        telegramUserId: "123",
        chatId: "123",
      }),
    ).toBe(true);
    expect(
      await repo.pair({
        botId: "42",
        tokenHash,
        telegramUserId: "456",
        chatId: "456",
      }),
    ).toBe(false);
  });
  it("rejects pairing issuance for stale MFA", async () => {
    const m = await staff("stale");
    await expect(
      repo.createPairing({
        sessionHash: m.sessionHash,
        botId: "42",
        tokenHash: hash(),
      }),
    ).rejects.toThrow("verification_forbidden");
  });
  it("checks fresh MFA again at consumption", async () => {
    const m = await staff(),
      tokenHash = hash();
    await repo.createPairing({
      sessionHash: m.sessionHash,
      botId: "42",
      tokenHash,
    });
    await database.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '20 minutes' where session_id_hash=${m.sessionHash}`,
    );
    await expect(
      repo.pair({
        botId: "42",
        tokenHash,
        telegramUserId: "123",
        chatId: "123",
      }),
    ).rejects.toThrow("verification_forbidden");
  });
  it("rejects expired pairing even while original staff MFA remains fresh", async () => {
    const m = await staff(),
      tokenHash = hash();
    await repo.createPairing({
      sessionHash: m.sessionHash,
      botId: "42",
      tokenHash,
    });
    await database.db.execute(
      sql`update expert_manager_telegram_pairings set expires_at=clock_timestamp()-interval '1 second' where token_hash=${tokenHash}`,
    );
    expect(
      await repo.pair({
        botId: "42",
        tokenHash,
        telegramUserId: "123",
        chatId: "123",
      }),
    ).toBe(false);
  });
  it("cannot resolve an action from an unpaired raw Telegram identity", async () => {
    expect(
      await repo.resolveCallback({
        botId: "42",
        nonceHash: hash(),
        telegramUserId: "123",
        chatId: "123",
      }),
    ).toBeNull();
  });
});
