import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresHybridMessageRepository } from "../../packages/db/src/repositories/hybrid-message-repository.js";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PostgresOrderedTelegramOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
import { createConsentEgressGate } from "../../packages/db/src/repositories/consent-egress-gate.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

// EGRESS-01/03 (приёмка T18/T25, дефекты D5/D6 карты W1): отзыв согласия обязан остановить
// ещё не отправленное. Барьер стоит в выдаче строк очереди, поэтому он не обходится ни одной
// подменой диспетчера: без разрешённого согласия строка просто не будет заявлена.
let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 180_000);
afterAll(async () => testDb?.stop(), 60_000);

let sequence = 0;

/** Один клиентский диалог с одной очередью исходящих. */
async function dialogueWithPendingSend(): Promise<string> {
  const user = (
    await testDb!.db.execute<{ id: string }>(
      sql`insert into users (id) values (gen_random_uuid()) returning id`,
    )
  ).rows[0]!;
  sequence += 1;
  const dialogue = (
    await testDb!.db.execute<{ id: string }>(sql`
      insert into dialogues (tenant_key, user_id, provider, bot_key, external_chat_id)
      values ('tenant-1', ${user.id}::uuid, 'telegram', 'bot-1', ${`chat-${sequence}`})
      returning id
    `)
  ).rows[0]!;
  const deliveryKey = `delivery-${sequence}`;
  await testDb!.db.execute(sql`
    insert into integration_outbox(
      idempotency_key, topic, payload, correlation_id, reconciliation_key,
      payload_hash, dialogue_id, dialogue_sequence
    ) values (
      ${deliveryKey}, 'telegram.send_text.v1',
      ${JSON.stringify({
        deliveryId: deliveryKey,
        dialogueId: dialogue.id,
        sequence: 1,
        botKey: "bot-1",
        chatId: `chat-${sequence}`,
        text: "здравствуйтесь, пожалуйста",
      })}::jsonb,
      ${`corr-${sequence}`}, ${deliveryKey}, ${`0`.repeat(64)},
      ${dialogue.id}::uuid, 1
    )
  `);
  return user.id;
}

const decide = async (userId: string, decision: string) =>
  testDb!.db.execute(sql`
    insert into consents (user_id, consent_type, decision, policy_version)
    values (${userId}::uuid, 'client_messaging', ${decision}, 'messaging-v1')
  `);

const claim = (consentGate: { enabled: boolean }) =>
  new PostgresOrderedTelegramOutboxRepository(testDb!.db, consentGate).claim(
    10,
    "gate-worker",
    60_000,
    5,
  );

describe("egress consent barrier on the outbound queue", () => {
  it("never replays unstamped pregrant work and admits a newly stamped reply", async () => {
    const userId = await dialogueWithPendingSend();

    expect(await claim({ enabled: true })).toHaveLength(0);

    await decide(userId, "granted");
    const granted = await claim({ enabled: true });
    expect(granted).toHaveLength(0);
    await seedClientConsent(testDb!.db, userId, "client_messaging");
    await testDb!.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','808','fresh-bot','808','active')`,
    );
    expect(
      await new PostgresHybridMessageRepository(testDb!.db).persist({
        updateId: 1n,
        payloadHash: "a".repeat(64),
        provider: "telegram",
        botKey: "fresh-bot",
        externalUserId: "808",
        externalChatId: "808",
        text: "Synthetic input",
        route: "deterministic",
        routingEnabled: false,
        correlationId: "fresh",
        locale: "ru-RU",
        deadline: new Date(Date.now() + 60_000).toISOString(),
        occurredAt: new Date().toISOString(),
        messagingConsentPolicyVersion: "client-messaging-v1",
      }),
    ).toBe("claimed");
    const claimed = await claim({ enabled: true });
    expect(claimed).toHaveLength(1);
    await decide(userId, "revoked");
    const message = claimed[0]!;
    expect(
      await new PostgresOrderedTelegramOutboxRepository(testDb!.db, {
        enabled: true,
      }).recordAttemptStarted(
        message.id,
        "gate-worker",
        message.dispatchClaimToken!,
        "withdrawn-attempt",
        message.reconciliationKey,
        new Date(),
        message.attempt,
      ),
    ).toEqual({ kind: "blocked", reasonCode: "client_authority_invalid" });
  });

  it("cannot bypass original authority by switching the old gate flag off", async () => {
    await dialogueWithPendingSend();
    // Тот же набор данных, выключенный гейт: выдача возвращается, значит остановка выше
    // обеспечивается именно барьером, а не совпадением.
    expect(await claim({ enabled: false })).toHaveLength(0);
  });

  it("treats a contradicted instant as no consent, like every other reader", async () => {
    const userId = await dialogueWithPendingSend();
    const at = "2026-09-21T12:00:00Z";
    for (const decision of ["denied", "granted"]) {
      await testDb!.db.execute(sql`
        insert into consents (user_id, consent_type, decision, policy_version, created_at)
        values (${userId}::uuid, 'client_messaging', ${decision}, 'messaging-v1',
                ${at}::timestamptz)
      `);
    }
    expect(await claim({ enabled: true })).toHaveLength(0);
  });
});

describe("pre-send consent gate against the journal", () => {
  const gate = () => createConsentEgressGate(testDb!.db);

  const dialogueOf = async (userId: string) => {
    sequence += 1;
    return (
      await testDb!.db.execute<{ id: string }>(sql`
        insert into dialogues (tenant_key, user_id, provider, bot_key, external_chat_id)
        values ('tenant-2', ${userId}::uuid, 'telegram', 'bot-2', ${`gate-${sequence}`})
        returning id
      `)
    ).rows[0]!.id;
  };

  it("follows the journal: nothing, granted, then revoked", async () => {
    const user = (
      await testDb!.db.execute<{ id: string }>(
        sql`insert into users (id) values (gen_random_uuid()) returning id`,
      )
    ).rows[0]!;
    const dialogue = await dialogueOf(user.id);
    expect(await gate().allowsSend(dialogue)).toBe(false);
    await decide(user.id, "granted");
    expect(await gate().allowsSend(dialogue)).toBe(true);
    await decide(user.id, "revoked");
    expect(await gate().allowsSend(dialogue)).toBe(false);
  });

  it("denies a dialogue that does not exist and a contradicted instant", async () => {
    expect(
      await gate().allowsSend("00000000-0000-4000-8000-000000000fff"),
    ).toBe(false);
    const user = (
      await testDb!.db.execute<{ id: string }>(
        sql`insert into users (id) values (gen_random_uuid()) returning id`,
      )
    ).rows[0]!;
    const dialogue = await dialogueOf(user.id);
    for (const decision of ["denied", "granted"]) {
      await testDb!.db.execute(sql`
        insert into consents (user_id, consent_type, decision, policy_version, created_at)
        values (${user.id}::uuid, 'client_messaging', ${decision}, 'messaging-v1',
                '2026-09-21T14:00:00Z'::timestamptz)
      `);
    }
    expect(await gate().allowsSend(dialogue)).toBe(false);
  });
});

describe("withdrawal journal ordering after a subject-lock wait", () => {
  for (const purpose of ["client_messaging", "expert_note"] as const) {
    it(`orders ${purpose} withdrawal (including cascade) after a grant committed while waiting`, async () => {
      const userId = (
        await testDb!.db.execute<{ id: string }>(
          sql`insert into users default values returning id`,
        )
      ).rows[0]!.id;
      let release!: () => void;
      let grant!: () => void;
      let ready!: () => void;
      const entered = new Promise<void>((r) => {
        ready = r;
      });
      const held = testDb!.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${userId}::uuid::text,0))`,
        );
        ready();
        await new Promise<void>((r) => {
          grant = r;
        });
        for (const p of purpose === "expert_note"
          ? [purpose, "expert_handoff"]
          : [purpose]) {
          await tx.execute(
            sql`insert into consents(user_id,consent_type,decision,policy_version,created_at) values(${userId}::uuid,${p},'granted','fixture-v1',clock_timestamp())`,
          );
        }
        await new Promise<void>((r) => {
          release = r;
        });
      });
      await entered;
      const withdrawal = new PostgresPrivacyRepository(testDb!.db, {
        privacyMutationCapability: { enabled: true },
      }).withdrawConsentAtomically({
        targetUserId: userId,
        purpose,
        policyVersion: "fixture-v1",
        correlationId: "post-wait-order",
      });
      try {
        for (let i = 0; i < 100; i++) {
          const waiting = (
            await testDb!.db.execute<{ n: number }>(
              sql`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event='advisory'`,
            )
          ).rows[0]!.n;
          if (waiting > 0) break;
          await new Promise((r) => setTimeout(r, 5));
          if (i === 99) throw new Error("withdrawal did not reach barrier");
        }
        grant();
        while (!release) await new Promise((r) => setTimeout(r, 1));
      } finally {
        grant();
        while (!release) await new Promise((r) => setTimeout(r, 1));
        release();
        await held;
      }
      await withdrawal;
      const rows = (
        await testDb!.db.execute<{ decision: string; projected: string }>(sql`
        select c.decision,s.decision projected from consent_states s join lateral
        (select decision from consents where user_id=s.user_id and consent_type=s.purpose order by created_at desc limit 1) c on true
        where s.user_id=${userId}::uuid order by s.purpose`)
      ).rows;
      expect(rows).toEqual(
        purpose === "expert_note"
          ? [
              { decision: "revoked", projected: "revoked" },
              { decision: "revoked", projected: "revoked" },
            ]
          : [{ decision: "revoked", projected: "revoked" }],
      );
    });
  }
});
