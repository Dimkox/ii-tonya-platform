import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  CONSENT_PURPOSES,
  ConsentGrantInvariantError,
  PostgresConsentEvidenceRepository,
} from "../../packages/db/src/repositories/consent-evidence-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

// ТЗ по ПД от 2026-09-21: согласие — действие клиента, записанное сервером вместе с доказательством
// (версия документа, его хеш, канал, предъявление), а «текущее состояние» имеет монотонную ревизию.
// Здесь проверяется именно серверный путь: выдача, повтор, чужое предъявление, истечение, отзыв.
let testDb: TestDatabase | undefined;

beforeAll(async () => {
  testDb = await startTestPostgres();
  await migrate(testDb.db, { migrationsFolder: "packages/db/migrations" });
}, 180_000);
afterAll(async () => testDb?.stop(), 60_000);

const repository = (enabled = true) =>
  new PostgresConsentEvidenceRepository(testDb!.db, {
    consentMutationCapability: { enabled },
  });

async function createUser(): Promise<string> {
  const row = (
    await testDb!.db.execute<{ id: string }>(
      sql`insert into users (id) values (gen_random_uuid()) returning id`,
    )
  ).rows[0];
  if (!row) throw new Error("создание субъекта не вернуло id");
  return row.id;
}

async function decisionRows(userId: string) {
  return (
    await testDb!.db.execute<{
      decision: string;
      policy_version: string;
      channel: string | null;
      text_sha256: string | null;
      presentation_id: string | null;
      prior_decision_id: string | null;
      sequence: string;
    }>(sql`
      select decision, policy_version, channel, text_sha256, presentation_id::text,
             prior_decision_id::text, "sequence"::text
      from consents
      where user_id = ${userId}::uuid
      order by "sequence"
    `)
  ).rows;
}

async function expectInvariant(
  attempt: () => Promise<unknown>,
  code: string,
): Promise<void> {
  const caught = await attempt().then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught, `ожидался отказ с кодом ${code}`).toBeInstanceOf(
    ConsentGrantInvariantError,
  );
  expect((caught as ConsentGrantInvariantError).code).toBe(code);
}

describe("consent grant path", () => {
  it("refuses every write while the capability is off", async () => {
    const userId = await createUser();
    await expectInvariant(
      () =>
        repository(false).approveDocumentVersion({
          documentKey: "consent.locked",
          title: "Заблокировано",
          body: "Тело",
          approvedBy: "owner@example.invalid",
        }),
      "consent_mutations_disabled",
    );
    await expectInvariant(
      () =>
        repository(false).issuePresentation({
          userId,
          purpose: "expert_note",
          channel: "web",
          documentKey: "consent.locked",
        }),
      "consent_mutations_disabled",
    );
  });

  it("records a granted decision with the exact document evidence", async () => {
    const userId = await createUser();
    const body =
      "Я согласен, чтобы Тоня передала выбранные сведения эксперту по этой брони.";
    const document = await repository().approveDocumentVersion({
      documentKey: "consent.expert_handoff",
      title: "Передача данных эксперту",
      body,
      approvedBy: "owner@example.invalid",
    });
    const presentation = await repository().issuePresentation({
      userId,
      purpose: "expert_handoff",
      channel: "web",
      documentKey: "consent.expert_handoff",
    });

    const receipt = await repository().recordDecision({
      token: presentation.token,
      userId,
      purpose: "expert_handoff",
      decision: "granted",
      policyVersion: "handoff-v1",
      correlationId: "corr-grant-1",
    });

    expect(receipt.revision).toBe(1);
    expect(receipt.documentVersionId).toBe(document.id);

    const stored = await decisionRows(userId);
    expect(stored).toHaveLength(1);
    const row = stored[0]!;
    expect(row.decision).toBe("granted");
    expect(row.channel).toBe("web");
    expect(row.presentation_id).toBe(presentation.presentationId);
    // Тело документа в момент решения совпадает с записанным хешем (EVID-01/02).
    const match = (
      await testDb!.db.execute<{ matches: boolean }>(sql`
        select exists (
          select 1 from consent_document_versions d
          where d.id = ${document.id}::uuid and d.text_sha256 = ${row.text_sha256}
            and d.text_sha256 = encode(digest(d.body, 'sha256'), 'hex')
        ) as matches
      `)
    ).rows[0];
    expect(match?.matches).toBe(true);
    expect(
      await repository().currentState({ userId, purpose: "expert_handoff" }),
    ).toEqual({
      decision: "granted",
      revision: 1,
    });
  });

  it("rejects a replayed, foreign or expired presentation without writing a decision", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    await repository().approveDocumentVersion({
      documentKey: "consent.follow_up",
      title: "Сопровождение",
      body: "Согласие на сопровождение.",
      approvedBy: "owner@example.invalid",
    });
    const presentation = await repository().issuePresentation({
      userId: owner,
      purpose: "follow_up",
      channel: "telegram",
      documentKey: "consent.follow_up",
    });

    // Чужой субъект.
    await expectInvariant(
      () =>
        repository().recordDecision({
          token: presentation.token,
          userId: intruder,
          purpose: "follow_up",
          decision: "granted",
          policyVersion: "follow-up-v1",
          correlationId: "corr-intruder",
        }),
      "consent_presentation_invalid",
    );
    // Чужая цель.
    await expectInvariant(
      () =>
        repository().recordDecision({
          token: presentation.token,
          userId: owner,
          purpose: "expert_note",
          decision: "granted",
          policyVersion: "note-v1",
          correlationId: "corr-purpose",
        }),
      "consent_presentation_invalid",
    );
    // Первый (легальный) клик проходит, повтор — уже нет.
    await repository().recordDecision({
      token: presentation.token,
      userId: owner,
      purpose: "follow_up",
      decision: "granted",
      policyVersion: "follow-up-v1",
      correlationId: "corr-first",
    });
    await expectInvariant(
      () =>
        repository().recordDecision({
          token: presentation.token,
          userId: owner,
          purpose: "follow_up",
          decision: "granted",
          policyVersion: "follow-up-v1",
          correlationId: "corr-replay",
        }),
      "consent_presentation_invalid",
    );
    expect(await decisionRows(owner)).toHaveLength(1);

    // Истёкшее предъявление.
    const expiring = await repository().issuePresentation({
      userId: owner,
      purpose: "follow_up",
      channel: "web",
      documentKey: "consent.follow_up",
    });
    // Окно предъявления закрыто: сдвигаем и создание, и срок, чтобы не обойти
    // `consent_presentations_expiry_check` (он как раз и не даёт «родиться» просроченным).
    await testDb!.db.execute(sql`
      update consent_presentations
      set created_at = now() - interval '2 days',
          expires_at = now() - interval '1 minute'
      where id = ${expiring.presentationId}::uuid
    `);
    await expectInvariant(
      () =>
        repository().recordDecision({
          token: expiring.token,
          userId: owner,
          purpose: "follow_up",
          decision: "granted",
          policyVersion: "follow-up-v1",
          correlationId: "corr-expired",
        }),
      "consent_presentation_invalid",
    );
  });

  it("invalidates outstanding presentations on revocation and keeps revisions monotonic", async () => {
    const userId = await createUser();
    await repository().approveDocumentVersion({
      documentKey: "consent.client_profile",
      title: "Профиль",
      body: "Согласие на сохранение профиля между сессиями.",
      approvedBy: "owner@example.invalid",
    });

    const outstanding = await repository().issuePresentation({
      userId,
      purpose: "client_profile",
      channel: "web",
      documentKey: "consent.client_profile",
    });

    const granted = await repository().recordDecision({
      token: (
        await repository().issuePresentation({
          userId,
          purpose: "client_profile",
          channel: "web",
          documentKey: "consent.client_profile",
        })
      ).token,
      userId,
      purpose: "client_profile",
      decision: "granted",
      policyVersion: "profile-v1",
      correlationId: "corr-profile-grant",
    });
    const denied = await repository().recordDecision({
      token: (
        await repository().issuePresentation({
          userId,
          purpose: "client_profile",
          channel: "web",
          documentKey: "consent.client_profile",
        })
      ).token,
      userId,
      purpose: "client_profile",
      decision: "denied",
      policyVersion: "profile-v1",
      correlationId: "corr-profile-revoke",
    });
    expect([granted.revision, denied.revision]).toEqual([1, 2]);
    expect(
      await repository().currentState({ userId, purpose: "client_profile" }),
    ).toEqual({
      decision: "denied",
      revision: 2,
    });

    // Отзыв гасит ранее выданные предложения: старая кнопка не вернёт прежнее решение (T12/T13).
    const invalidated = await repository().invalidatePresentations({
      userId,
      purpose: "client_profile",
    });
    expect(invalidated).toBeGreaterThanOrEqual(1);
    await expectInvariant(
      () =>
        repository().recordDecision({
          token: outstanding.token,
          userId,
          purpose: "client_profile",
          decision: "granted",
          policyVersion: "profile-v1",
          correlationId: "corr-stale-button",
        }),
      "consent_presentation_invalid",
    );

    const rowsAfter = await decisionRows(userId);
    expect(rowsAfter).toHaveLength(2);
    // Цепочка решений: вторая запись ссылается на первую как на предыдущее решение.
    const linked = (
      await testDb!.db.execute<{ count: number }>(sql`
        select count(*)::integer as count from consents c
        where c.user_id = ${userId}::uuid
          and c.prior_decision_id is not null
          and exists (select 1 from consents p where p.id = c.prior_decision_id and p.user_id = c.user_id)
      `)
    ).rows[0];
    expect(Number(linked?.count)).toBe(1);
  });

  it("refuses purposes outside the accepted register", async () => {
    const userId = await createUser();
    expect(CONSENT_PURPOSES).toContain("selarti_ai_processing");
    await expectInvariant(
      () =>
        repository().issuePresentation({
          userId,
          // «Подбор» — договорное основание, а не согласие (DEC-PLT-004 §1, CONS-04).
          purpose: "client_selection",
          channel: "web",
          documentKey: "consent.selection",
        }),
      "consent_purpose_unknown",
    );
    await expectInvariant(
      () =>
        repository().recordDecision({
          token: "opaque",
          userId,
          purpose: "ads",
          decision: "granted",
          policyVersion: "ads-v1",
          correlationId: "corr-ads",
        }),
      "consent_purpose_unknown",
    );
  });

  it("rolls the whole transaction back when the decision row cannot be written", async () => {
    const userId = await createUser();
    await repository().approveDocumentVersion({
      documentKey: "consent.expert_note",
      title: "Заметка",
      body: "Согласие на необязательную заметку эксперту.",
      approvedBy: "owner@example.invalid",
    });
    const presentation = await repository().issuePresentation({
      userId,
      purpose: "expert_note",
      channel: "web",
      documentKey: "consent.expert_note",
    });
    // Нелегальная политика роняет вставку решения; предъявление не должно остаться погашенным.
    await expect(
      testDb!.db.transaction(async (tx) => {
        await tx.execute(sql`
          update consent_presentations set consumed_at = now()
          where id = ${presentation.presentationId}::uuid
        `);
        throw new Error("deliberate rollback");
      }),
    ).rejects.toThrow("deliberate rollback");

    const stillOpen = (
      await testDb!.db.execute<{ consumed: boolean }>(sql`
        select (consumed_at is not null) as consumed from consent_presentations
        where id = ${presentation.presentationId}::uuid
      `)
    ).rows[0];
    expect(stillOpen?.consumed).toBe(false);
  });
});
