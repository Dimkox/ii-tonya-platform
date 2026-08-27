import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, createDb } from "../../packages/db/src/client.js";
import { PostgresExpertTelegramResidencyCallbackRepository } from "../../packages/db/src/repositories/expert-telegram-residency-callback-repository.js";

const schema = "expert_telegram_xr1_test";
const connectionString = process.env.II_TONYA_TEST_POSTGRES_ADMIN_URL;
const isolatedUrl = new URL(connectionString ?? "postgresql://invalid");
isolatedUrl.searchParams.set("options", `-c search_path=${schema},public`);
const db = createDb(isolatedUrl.toString());
const repository = new PostgresExpertTelegramResidencyCallbackRepository(db);
const expertId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000100";
const tariffVersionId = "00000000-0000-4000-8000-000000000301";

const describeShared = connectionString === undefined ? describe.skip : describe;

describeShared("expert Telegram xr1 repository on shared Claw PostgreSQL", () => {
  beforeAll(async () => {
    await db.execute(
      sql.raw(`drop schema if exists ${schema} cascade; create schema ${schema};
      create table users(id uuid primary key, active boolean not null);
      create table experts(id uuid primary key, user_id uuid not null references users(id), active boolean not null, verified boolean not null);
      create table channel_identities(user_id uuid not null references users(id), provider text not null, external_id text not null);
      create table expert_residency_tariff_versions(id uuid primary key);
      insert into users values ('${userId}',true);
      insert into experts values ('${expertId}','${userId}',true,true);
      insert into channel_identities values ('${userId}','telegram','123456789');
      insert into expert_residency_tariff_versions values ('${tariffVersionId}');`),
    );
    for (const path of [
      "packages/db/migrations/0025_expert_telegram_residency_callbacks.sql",
      "packages/db/migrations/0026_expert_telegram_checkout_outcomes.sql",
    ]) {
      const migration = await readFile(path, "utf8");
      for (const statement of migration
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean))
        await db.execute(sql.raw(statement));
    }
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema if exists ${schema} cascade`));
    await closeDb(db);
  });
  beforeEach(async () => {
    await db.execute(sql`truncate expert_telegram_residency_callbacks`);
    await db.execute(
      sql`update users set active=true where id=${userId}::uuid`,
    );
  });

  it("binds and consumes an xr1 callback exactly once", async () => {
    const tokenHash = "a".repeat(64);
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:1");
    const binding = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
    };
    const winners = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.consume(tokenHash, binding, new Date()),
      ),
    );
    expect(winners.filter((result) => result !== null)).toHaveLength(1);
  });

  it("rejects consume after the bound user is deactivated", async () => {
    const tokenHash = "b".repeat(64);
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(Date.now() + 60_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:2");
    await db.execute(
      sql`update users set active=false where id=${userId}::uuid`,
    );
    await expect(
      repository.consume(
        tokenHash,
        {
          expertId,
          telegramUserId: "123456789",
          tariffVersionId,
          action: "start_residency_checkout",
        },
        new Date(),
      ),
    ).resolves.toBeNull();
  });

  it("fences one checkout winner and returns the stored terminal replay", async () => {
    const tokenHash = "c".repeat(64);
    const now = new Date();
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:3");
    await expect(
      repository.inspectCheckout(
        tokenHash,
        expertId,
        claims.telegramUserId,
        now,
      ),
    ).resolves.toMatchObject({ tariffVersionId });

    const winners = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.claimCheckout(
          tokenHash,
          claims,
          now,
          new Date(now.getTime() + 30_000),
          randomUUID(),
        ),
      ),
    );
    const acquired = winners.filter((result) => result?.kind === "acquired");
    expect(acquired).toHaveLength(1);
    const winner = acquired[0];
    if (winner?.kind !== "acquired") throw new Error("missing winner");
    await expect(
      repository.recordCheckoutOutcome(
        tokenHash,
        randomUUID(),
        { kind: "ready", checkoutUrl: "https://pay.example/checkout" },
        now,
      ),
    ).resolves.toBe(false);
    await expect(
      repository.recordCheckoutOutcome(
        tokenHash,
        winner.fence,
        { kind: "ready", checkoutUrl: "https://pay.example/checkout" },
        now,
      ),
    ).resolves.toBe(true);
    await expect(
      repository.claimCheckout(
        tokenHash,
        claims,
        now,
        new Date(now.getTime() + 30_000),
        randomUUID(),
      ),
    ).resolves.toEqual({
      kind: "replay",
      tokenHash,
      outcome: {
        kind: "ready",
        checkoutUrl: "https://pay.example/checkout",
      },
    });
  });

  it("leases one expired-processing recovery and rejects stale fencing", async () => {
    const tokenHash = "d".repeat(64);
    const now = new Date();
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:4");
    const first = await repository.claimCheckout(
      tokenHash,
      claims,
      now,
      new Date(now.getTime() + 1_000),
      randomUUID(),
    );
    if (first?.kind !== "acquired") throw new Error("missing first claim");
    const recoveryNow = new Date(now.getTime() + 2_000);
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.claimCheckout(
          tokenHash,
          claims,
          recoveryNow,
          new Date(recoveryNow.getTime() + 30_000),
          randomUUID(),
        ),
      ),
    );
    const recovered = attempts.filter((result) => result?.kind === "acquired");
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ recovery: true });
    await expect(
      repository.recordCheckoutOutcome(
        tokenHash,
        first.fence,
        { kind: "unknown" },
        recoveryNow,
      ),
    ).resolves.toBe(false);
  });

  it("physically clears a stored checkout URL at expiry", async () => {
    const tokenHash = "e".repeat(64);
    const now = new Date();
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(now.getTime() + 2_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:5");
    const claim = await repository.claimCheckout(
      tokenHash,
      claims,
      now,
      new Date(now.getTime() + 1_000),
      randomUUID(),
    );
    if (claim?.kind !== "acquired") throw new Error("missing claim");
    await repository.recordCheckoutOutcome(
      tokenHash,
      claim.fence,
      { kind: "ready", checkoutUrl: "https://pay.example/expiring" },
      now,
    );
    await expect(repository.clearExpiredCheckoutUrls(now, 100)).resolves.toBe(
      0,
    );
    await expect(
      repository.clearExpiredCheckoutUrls(
        new Date(claims.expiresAt.getTime() + 1),
        100,
      ),
    ).resolves.toBe(1);
    const state = await db.execute<{
      checkoutUrl: string | null;
      checkoutStatus: string;
    }>(sql`select checkout_url as "checkoutUrl",checkout_status as "checkoutStatus"
           from expert_telegram_residency_callbacks where token_hash=${tokenHash}`);
    expect(state.rows[0]).toEqual({
      checkoutUrl: null,
      checkoutStatus: "unavailable",
    });
  });

  it("downgrades a ready outcome completed after callback expiry", async () => {
    const tokenHash = "f".repeat(64);
    const now = new Date();
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(now.getTime() + 1_000),
    };
    await repository.put(tokenHash, claims, "telegram:quote:late-ready");
    const claim = await repository.claimCheckout(
      tokenHash,
      claims,
      now,
      claims.expiresAt,
      randomUUID(),
    );
    if (claim?.kind !== "acquired") throw new Error("missing claim");

    await expect(
      repository.recordCheckoutOutcome(
        tokenHash,
        claim.fence,
        { kind: "ready", checkoutUrl: "HTTPS://pay.example/late" },
        new Date(claims.expiresAt.getTime() + 1),
      ),
    ).resolves.toBe(false);
    const state = await db.execute<{
      checkoutUrl: string | null;
      checkoutStatus: string;
    }>(sql`select checkout_url as "checkoutUrl",checkout_status as "checkoutStatus"
           from expert_telegram_residency_callbacks where token_hash=${tokenHash}`);
    expect(state.rows[0]).toEqual({
      checkoutUrl: null,
      checkoutStatus: "unavailable",
    });
  });

  it("requires a ready URL and accepts an uppercase HTTPS scheme", async () => {
    const now = new Date();
    const claims = {
      expertId,
      telegramUserId: "123456789",
      tariffVersionId,
      action: "start_residency_checkout" as const,
      expiresAt: new Date(now.getTime() + 60_000),
    };
    const missingUrlHash = "7".repeat(64);
    await repository.put(missingUrlHash, claims, "telegram:quote:null-ready");
    const missingUrlClaim = await repository.claimCheckout(
      missingUrlHash,
      claims,
      now,
      new Date(now.getTime() + 30_000),
      randomUUID(),
    );
    if (missingUrlClaim?.kind !== "acquired") throw new Error("missing claim");
    await expect(
      db.execute(sql`update expert_telegram_residency_callbacks
        set checkout_status='ready',checkout_url=null,processing_fence=null,
            processing_lease_until=null,outcome_recorded_at=${now}
        where token_hash=${missingUrlHash}`),
    ).rejects.toThrow();

    const uppercaseHash = "8".repeat(64);
    await repository.put(uppercaseHash, claims, "telegram:quote:uppercase");
    const uppercaseClaim = await repository.claimCheckout(
      uppercaseHash,
      claims,
      now,
      new Date(now.getTime() + 30_000),
      randomUUID(),
    );
    if (uppercaseClaim?.kind !== "acquired") throw new Error("missing claim");
    await expect(
      repository.recordCheckoutOutcome(
        uppercaseHash,
        uppercaseClaim.fence,
        { kind: "ready", checkoutUrl: "HTTPS://pay.example/checkout" },
        now,
      ),
    ).resolves.toBe(true);
  });
});
