import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PostgresOrderedTelegramOutboxRepository } from "../../packages/db/src/repositories/outbox-repository.js";
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
  it("holds a pending client message back until the subject grants, and stops again after revocation", async () => {
    const userId = await dialogueWithPendingSend();

    expect(await claim({ enabled: true })).toHaveLength(0);

    await decide(userId, "granted");
    const granted = await claim({ enabled: true });
    expect(granted).toHaveLength(1);

    await decide(userId, "revoked");
    const second = await dialogueWithPendingSend();
    await decide(second, "granted");
    expect(await claim({ enabled: true })).toHaveLength(1);
    await decide(second, "revoked");
    expect(await claim({ enabled: true })).toHaveLength(0);
  });

  it("lets the same row through when the gate is explicitly off (control)", async () => {
    await dialogueWithPendingSend();
    // Тот же набор данных, выключенный гейт: выдача возвращается, значит остановка выше
    // обеспечивается именно барьером, а не совпадением.
    expect(await claim({ enabled: false })).toHaveLength(1);
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
