import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createHash } from "node:crypto";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

// ТЗ по ПД от 2026-09-21, EVID-01…04 + D2/D3 из карты W1: согласие — это-append-only факт с
// доказательством (версия документа, хеш тела, канал, предъявление, предыдущее решение), а
// «текущее состояние» — проекция с монотонной ревизией. Тест проверяет, что миграция 0039
// действительно даёт эти гарантии на живом PostgreSQL, а не только в тексте SQL.
let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 180_000);
afterAll(async () => testDb?.stop(), 60_000);

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

async function scalar<T extends Record<string, unknown>>(
  query: ReturnType<typeof sql>,
): Promise<T> {
  const rows = (await testDb!.db.execute<T>(query)).rows;
  return rows[0] as T;
}

async function createUser(): Promise<string> {
  const row = await scalar<{ id: string }>(sql`
    insert into users (id) values (gen_random_uuid()) returning id
  `);
  return row.id;
}

async function failsWith(query: ReturnType<typeof sql>, fragment: string) {
  const attempt = await testDb!.db
    .execute(query)
    .then(() => ({ failed: false, signature: "" }))
    .catch((error: unknown) => {
      const raw = error as Record<string, unknown>;
      const cause = (raw?.cause ?? {}) as Record<string, unknown>;
      const signature = [
        raw?.message,
        cause?.message,
        raw?.constraint,
        cause?.constraint,
        raw?.code,
        cause?.code,
        raw?.detail,
        cause?.detail,
      ]
        .filter(Boolean)
        .join(" | ");
      return { failed: true, signature };
    });
  expect(
    {
      failed: attempt.failed,
      hasFragment: attempt.signature.includes(fragment),
    },
    `ожидалось отклонение с «${fragment}», получили: ${attempt.signature.slice(0, 400) || "прошло без ошибки"}`,
  ).toEqual({ failed: true, hasFragment: true });
}

describe("consent evidence schema (migration 0039)", () => {
  it("creates the three evidence relations and the added consents columns", async () => {
    const tables = (
      await testDb!.db.execute<{ name: string }>(sql`
        select table_name as name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('consent_document_versions', 'consent_presentations', 'consent_states')
      `)
    ).rows.map((row) => row.name);
    expect(tables.sort()).toEqual([
      "consent_document_versions",
      "consent_presentations",
      "consent_states",
    ]);

    const columns = (
      await testDb!.db.execute<{ name: string }>(sql`
        select column_name as name from information_schema.columns
        where table_schema = 'public' and table_name = 'consents'
      `)
    ).rows.map((row) => row.name);
    for (const expected of [
      "sequence",
      "channel",
      "scope_fields",
      "document_version_id",
      "presentation_id",
      "prior_decision_id",
      "recipient_id",
      "reservation_id",
      "text_sha256",
      "basis",
    ]) {
      expect(columns).toContain(expected);
    }
  });

  it("keeps insert order authoritative when two decisions share the same timestamp", async () => {
    const userId = await createUser();
    const at = new Date("2026-09-21T10:00:00.000Z");
    // Два решения по одной цели с идентичным created_at: без «sequence» такой пары нельзя
    // разрешить детерминированно (дефект D2 из карты W1).
    for (const decision of ["granted", "denied"]) {
      await testDb!.db.execute(sql`
        insert into consents (user_id, consent_type, decision, policy_version, created_at)
        values (${userId}::uuid, 'expert_handoff', ${decision}, 'handoff-v1', ${at.toISOString()})
      `);
    }
    const sequences = (
      await testDb!.db.execute<{ sequence: number; decision: string }>(sql`
        select "sequence"::text as "sequence", decision from consents
        where user_id = ${userId}::uuid and consent_type = 'expert_handoff'
        order by created_at desc, "sequence" desc
      `)
    ).rows;
    const latest = sequences[0];
    const earlier = sequences[1];
    if (!latest || !earlier)
      throw new Error("обе строки решения должны существовать");
    expect([latest.decision, earlier.decision]).toEqual(["denied", "granted"]);
    expect(Number(latest.sequence)).toBeGreaterThan(Number(earlier.sequence));

    // Тот же набор без «sequence» даёт неопределённый порядок: контроль, что именно новая
    // колонка делает разрешение детерминированным.
    const withoutSequenceRow = (
      await testDb!.db.execute<{ count: number }>(sql`
        select count(distinct decision)::integer as count from consents
        where user_id = ${userId}::uuid and consent_type = 'expert_handoff'
          and created_at = ${at.toISOString()}::timestamptz
      `)
    ).rows[0];
    if (!withoutSequenceRow) throw new Error("счётчик решений не вернулся");
    expect(Number(withoutSequenceRow.count)).toBe(2);
  });

  it("rejects an unknown decision value and an out-of-vocabulary channel", async () => {
    const userId = await createUser();
    await failsWith(
      sql`
        insert into consents (user_id, consent_type, decision, policy_version)
        values (${userId}::uuid, 'expert_note', 'maybe', 'note-v1')
      `,
      "consents_decision_known",
    );
    await failsWith(
      sql`
        insert into consents (user_id, consent_type, decision, policy_version, channel)
        values (${userId}::uuid, 'expert_note', 'granted', 'note-v1', 'carrier-pigeon')
      `,
      "consents_channel_known",
    );
  });

  it("binds a granted decision to the exact document text through the digest", async () => {
    const userId = await createUser();
    const body =
      "Я согласен на передачу выбранных сведений эксперту по этой брони.";
    const version = await scalar<{ id: string }>(sql`
      insert into consent_document_versions
        (document_key, version, title, body, text_sha256, status, approved_at, approved_by)
      values
        ('consent.expert_handoff', 1, 'Передача данных эксперту', ${body},
         ${sha256(body)}, 'approved', now(), ${"owner@example.invalid"})
      returning id
    `);

    // Тело, не совпадающее с заявленным хешем, не принимается (EVID-01, EVID-02).
    await failsWith(
      sql`
        insert into consent_document_versions
          (document_key, version, title, body, text_sha256, status, approved_at, approved_by)
        values
          ('consent.expert_handoff', 2, 'Поддельная версия', ${body + " "},
           ${sha256(body)}, 'approved', now(), 'owner@example.invalid')
      `,
      "consent_document_body_matches_digest",
    );

    await testDb!.db.execute(sql`
      insert into consents
        (user_id, consent_type, decision, policy_version, channel, document_version_id, text_sha256, basis)
      values
        (${userId}::uuid, 'expert_handoff', 'granted', 'handoff-v1', 'web',
         ${version.id}::uuid, ${sha256(body)}, 'consent')
    `);
    const stored = await scalar<{ sha: string; doc: string }>(sql`
      select c.text_sha256 as sha, c.document_version_id::text as doc
      from consents c where c.user_id = ${userId}::uuid and c.consent_type = 'expert_handoff'
      order by c."sequence" desc limit 1
    `);
    expect(stored.sha).toBe(sha256(body));
    expect(stored.doc).toBe(version.id);

    // Документ неизменяем: правка задним числом отклоняется триггером append-only.
    await failsWith(
      sql`update consent_document_versions set body = 'переписано' where id = ${version.id}::uuid`,
      "append-only facts cannot be changed",
    );
  });

  it("enforces single-use, expiry and subject binding of a presentation", async () => {
    const userId = await createUser();
    const body =
      "Согласие на обработку персональных данных для выбранной функции.";
    const version = await scalar<{ id: string }>(sql`
      insert into consent_document_versions
        (document_key, version, title, body, text_sha256, status, approved_at, approved_by)
      values ('consent.client_messaging', 1, 'Сообщения', ${body}, ${sha256(body)},
              'approved', now(), 'owner@example.invalid')
      returning id
    `);
    const digest = `sha256:${sha256("token-value")}`;
    await testDb!.db.execute(sql`
      insert into consent_presentations
        (user_id, purpose, document_version_id, token_digest, channel, expires_at)
      values (${userId}::uuid, 'client_messaging', ${version.id}::uuid, ${digest},
              'web', now() + interval '24 hours')
    `);
    // Повторный вброс того же токена невозможен (BOT-04/T06, WEB-04).
    await failsWith(
      sql`
        insert into consent_presentations
          (user_id, purpose, document_version_id, token_digest, channel, expires_at)
        values (${userId}::uuid, 'client_messaging', ${version.id}::uuid, ${digest},
                'web', now() + interval '24 hours')
      `,
      "consent_presentations_token_unique",
    );
    // Токен не может «родиться» просроченным (EVID-04).
    await failsWith(
      sql`
        insert into consent_presentations
          (user_id, purpose, document_version_id, token_digest, channel, expires_at)
        values (${userId}::uuid, 'client_messaging', ${version.id}::uuid,
                ${`sha256:${sha256("expired-token")}`}, 'web',
                now() - interval '1 hour')
      `,
      "consent_presentations_expiry_check",
    );
    // Ровно один субъект: либо аккаунт, либо анонимная сессия (WEB-05).
    await failsWith(
      sql`
        insert into consent_presentations
          (purpose, document_version_id, token_digest, channel, expires_at)
        values ('client_messaging', ${version.id}::uuid,
                ${`sha256:${sha256("no-subject")}`}, 'web', now() + interval '1 hour')
      `,
      "consent_presentations_subject_check",
    );
  });

  it("keeps the current-state projection single-valued and monotonically revised", async () => {
    const userId = await createUser();
    await testDb!.db.execute(sql`
      insert into consent_states (user_id, purpose, decision, revision)
      values (${userId}::uuid, 'follow_up', 'granted', 1)
    `);
    await failsWith(
      sql`
        insert into consent_states (user_id, purpose, decision, revision)
        values (${userId}::uuid, 'follow_up', 'denied', 2)
      `,
      "consent_states_pkey",
    );
    await failsWith(
      sql`
        insert into consent_states (user_id, purpose, decision, revision)
        values (${userId}::uuid, 'follow_up', 'granted', 0)
      `,
      "consent_states_revision_positive",
    );
    const bumped = await scalar<{ revision: number }>(sql`
      insert into consent_states (user_id, purpose, decision, revision)
      values (${userId}::uuid, 'follow_up', 'denied', 1)
      on conflict (user_id, purpose)
        do update set decision = excluded.decision,
                      revision = consent_states.revision + 1,
                      updated_at = now()
      returning revision
    `);
    expect(Number(bumped.revision)).toBe(2);
  });
});
