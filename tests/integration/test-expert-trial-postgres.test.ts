import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresTestExpertTrialRepository } from "../../packages/db/src/repositories/test-expert-trial-repository.js";
import { PostgresSelartiProposalRepository } from "../../packages/db/src/repositories/selarti-proposal-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

describe("test expert trial PostgreSQL authority", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await startTestPostgres();
    await database.migrate();
  }, 120_000);
  afterAll(async () => {
    await database?.stop();
  }, 60_000);

  it("upgrades through 0037 to 0038 without seeding active campaigns", async () => {
    const migrations = await database.db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(Number(migrations.rows[0]?.count)).toBeGreaterThanOrEqual(39);
    const active = await database.db.execute<{ count: string }>(
      sql`select count(*)::text as count from test_expert_campaign_versions where status='active'`,
    );
    expect(active.rows[0]?.count).toBe("0");
  });

  it("enforces FK and cap constraints while concurrent reservations serialize", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000381";
    await database.db.execute(
      sql`insert into test_expert_campaign_versions (id,code,version) values (${campaignId}::uuid,'test-expert',1)`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: "pg-redemption-1",
    });
    const raced = await Promise.all(
      ["pg-request-a", "pg-request-b"].map((requestKey) =>
        repository.reserveAiTurn({
          redemptionId: redemption.id,
          requestKey,
          requestDigest: "a".repeat(64),
        }),
      ),
    );
    expect(raced).toHaveLength(2);
    await repository.recordOutcome({
      reservationId: raced[0]!.reservationId,
      outcome: "applied",
      providerRequestId: "sha256:" + "a".repeat(64),
    });
    await repository.recordOutcome({
      reservationId: raced[1]!.reservationId,
      outcome: "applied",
      providerRequestId: "sha256:" + "b".repeat(64),
    });
    const summary = await repository.summary(redemption.id);
    expect(summary).toMatchObject({ consumedUnits: 4, reservedUnits: 0 });
    await expect(
      database.db.execute(
        sql`insert into test_expert_redemptions (campaign_version_id,user_id,redemption_idempotency_key) values (${campaignId}::uuid,'00000000-0000-4000-8000-000000000399'::uuid,'bad-fk')`,
      ),
    ).rejects.toSatisfy(
      (error: { cause?: { code?: string } }) => error.cause?.code === "23503",
    );
  });

  it("keeps unknown reservations until explicit reconciliation and exposes an indexed lookup plan", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000382";
    await database.db.execute(
      sql`insert into test_expert_campaign_versions (id,code,version) values (${campaignId}::uuid,'test-expert',2)`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: "pg-redemption-2",
    });
    const reservation = await repository.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: "pg-request-unknown",
      requestDigest: "b".repeat(64),
    });
    await repository.recordOutcome({
      reservationId: reservation.reservationId,
      outcome: "unknown",
      providerRequestId: "sha256:" + "c".repeat(64),
    });
    await expect(repository.summary(redemption.id)).resolves.toMatchObject({
      consumedUnits: 0,
      reservedUnits: 2,
    });
    await expect(
      repository.reconcileUnknown({
        reservationId: reservation.reservationId,
        outcome: "not_applied",
        providerRequestId: "sha256:" + "c".repeat(64),
      }),
    ).resolves.toMatchObject({ consumedUnits: 0, reservedUnits: 0 });
    const plan = await database.db.execute<{ plan: string }>(
      sql`explain (format json) select id from test_expert_redemptions where id=${redemption.id}::uuid for update`,
    );
    expect(JSON.stringify(plan.rows)).toContain("test_expert_redemptions");
  });

  it("converges an identical same-key race and rejects a conflicting digest", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000383";
    await database.db.execute(
      sql`insert into test_expert_campaign_versions (id,code,version) values (${campaignId}::uuid,'test-expert-race',1)`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: `test-expert:${campaignId}:${userId}`,
    });
    const input = {
      redemptionId: redemption.id,
      requestKey: "telegram:race:test-expert",
      requestDigest: "c".repeat(64),
    };
    const [left, right] = await Promise.all([
      repository.reserveAiTurn(input),
      repository.reserveAiTurn(input),
    ]);
    expect(left.reservationId).toBe(right.reservationId);
    await expect(
      repository.reserveAiTurn({
        ...input,
        requestDigest: "d".repeat(64),
      }),
    ).rejects.toThrow("request_idempotency_conflict");
    await expect(repository.summary(redemption.id)).resolves.toMatchObject({
      consumedUnits: 0,
      reservedUnits: 2,
    });
  });

  it("enforces prompt authority, provider uniqueness, unknown scan and immutable atomic audit", async () => {
    const userId = await database.createUser();
    const promptId = "00000000-0000-4000-8000-000000000384";
    const campaignId = "00000000-0000-4000-8000-000000000385";
    await database.db.execute(sql`
      insert into test_expert_prompt_assets(
        id,asset_key,version,sha256,source_path,status,official_contract_evidence
      ) values(
        ${promptId}::uuid,'expert.functional',1,${"e".repeat(64)},
        'docs/source/ii-tonya-expert-full-source-2026-07-28.txt','inactive',
        'evidence://external-ci/official-selarti-contract'
      )`);
    await database.db.execute(
      sql`update test_expert_prompt_assets set status='approved' where id=${promptId}::uuid`,
    );
    await database.db.execute(sql`
      insert into test_expert_campaign_versions(
        id,code,version,status,prompt_asset_id,prompt_asset_version,effective_from
      ) values(${campaignId}::uuid,'test-expert-external',1,'inactive',${promptId}::uuid,1,now())`);
    await database.db.execute(
      sql`update test_expert_campaign_versions set status='active' where id=${campaignId}::uuid`,
    );
    const repository = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await repository.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: `test-expert:${campaignId}:${userId}`,
    });
    const first = await repository.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: "external-db-first",
      requestDigest: "f".repeat(64),
    });
    const second = await repository.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: "external-db-second",
      requestDigest: "0".repeat(64),
    });
    await repository.recordOutcome({
      reservationId: first.reservationId,
      outcome: "unknown",
      providerRequestId: "sha256:" + "1".repeat(64),
    });
    await expect(
      repository.recordOutcome({
        reservationId: second.reservationId,
        outcome: "applied",
        providerRequestId: "sha256:" + "1".repeat(64),
      }),
    ).rejects.toSatisfy(
      (error: { cause?: { code?: string } }) => error.cause?.code === "23505",
    );
    await expect(
      repository.recordOutcome({
        reservationId: first.reservationId,
        outcome: "not_applied",
        providerRequestId: "sha256:" + "1".repeat(64),
      }),
    ).rejects.toThrow("unknown_outcome_requires_reconciliation");
    const audit = await database.db.execute<{ id: string }>(sql`
      select id from test_expert_audit_events
      where reservation_id=${first.reservationId}::uuid order by created_at,id limit 1`);
    await expect(
      database.db.execute(
        sql`delete from test_expert_audit_events where id=${audit.rows[0]!.id}::uuid`,
      ),
    ).rejects.toThrow();
    const plan = await database.db.execute(sql`
      explain (format json) select id from test_expert_reservations
      where status in ('reserved','unknown') and created_at < now()-interval '1 minute'
      order by created_at,id limit 25`);
    expect(JSON.stringify(plan.rows)).toContain(
      "test_expert_reservations_unknown_global_idx",
    );
    await expect(
      database.db.execute(
        sql`update test_expert_campaign_versions set status='inactive' where id=${campaignId}::uuid`,
      ),
    ).rejects.toThrow();
    await database.db.execute(
      sql`update test_expert_campaign_versions set status='retired' where id=${campaignId}::uuid`,
    );
    const lifecycle = await database.db.execute<{ count: string }>(sql`
      select count(*)::text count from test_expert_lifecycle_audit_events
      where entity_id in (${promptId}::uuid,${campaignId}::uuid)`);
    expect(Number(lifecycle.rows[0]!.count)).toBeGreaterThanOrEqual(3);
    await expect(
      database.db.execute(
        sql`delete from test_expert_lifecycle_audit_events where entity_id=${campaignId}::uuid`,
      ),
    ).rejects.toThrow();
  });

  it("captures original messaging authority in the real trial producer before session persistence", async () => {
    const userId = await database.createUser();
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','919','trial-fence','919','active')`,
    );
    const authority = await seedClientConsent(
      database.db,
      userId,
      "client_messaging",
    );
    const producer = new PostgresTestExpertTelegramRepository(database.db, {
      messagingConsentPolicyVersion: "client-messaging-v1",
    });
    const input = {
      botKey: "trial-fence",
      telegramUserId: "919",
      chatId: "919",
      userId,
      expectedSessionVersion: null,
      nextSession: { version: 1, state: "awaiting_name" as const },
      replyText: "Synthetic reply",
      copyVersion: "fixture-v1",
      sellingActivation: "inactive" as const,
      trialUnits: 0 as const,
      requestKey: "trial-fence-request",
      requestDigest: "6".repeat(64),
      correlationId: "trial-fence",
      occurredAt: new Date().toISOString(),
    };
    expect(await producer.deliverDeterministic(input)).toMatchObject({
      kind: "applied",
    });
    expect(
      (
        await database.db.execute<{ payload: unknown }>(
          sql`select payload from integration_outbox where correlation_id='trial-fence'`,
        )
      ).rows[0]!.payload,
    ).toMatchObject({
      consentAuthority: {
        v: 1,
        subjectId: userId,
        purposes: { client_messaging: authority },
      },
    });
    await database.db.execute(
      sql`delete from consent_states where user_id=${userId}::uuid`,
    );
    await expect(
      producer.deliverDeterministic({ ...input, requestKey: "blocked" }),
    ).rejects.toThrow("test_expert_consent_denied");
    expect(
      (
        await database.db.execute<{ n: number }>(
          sql`select count(*)::int n from test_expert_sessions where user_id=${userId}::uuid`,
        )
      ).rows[0]!.n,
    ).toBe(1);
  });
  it("converges a trial reservation only with the durable B2 response and same-dialogue delivery", async () => {
    const userId = await database.createUser();
    const campaignId = "00000000-0000-4000-8000-000000000386";
    await database.db.execute(sql`
      insert into test_expert_campaign_versions(id,code,version)
      values(${campaignId}::uuid,'test-expert-b2',1)`);
    const trial = new PostgresTestExpertTrialRepository(database.db);
    const redemption = await trial.createOrGetRedemption({
      campaignVersionId: campaignId,
      userId,
      idempotencyKey: `test-expert:${campaignId}:${userId}`,
    });
    const reservation = await trial.reserveAiTurn({
      redemptionId: redemption.id,
      requestKey: "external-b2-request",
      requestDigest: "2".repeat(64),
    });
    const providerRequestId = `sha256:${"3".repeat(64)}`;
    await trial.recordOutcome({
      reservationId: reservation.reservationId,
      outcome: "unknown",
      providerRequestId,
    });
    const dialogue = await database.db.execute<{ id: string }>(sql`
      insert into dialogues(tenant_key,user_id,provider,bot_key,external_chat_id)
      values('bot-trial-b2',${userId}::uuid,'telegram','bot-trial-b2','909')
      returning id`);
    const dialogueId = dialogue.rows[0]!.id;
    const receivedAt = new Date();
    const deadline = new Date(receivedAt.getTime() + 30_000).toISOString();
    const payload = {
      requestId: providerRequestId,
      dialogueId,
      deadline,
      userId,
      text: "Synthetic request",
      consentAuthority: {
        v: 1,
        subjectId: userId,
        purposes: {
          client_messaging: await seedClientConsent(
            database.db,
            userId,
            "client_messaging",
          ),
          selarti_ai_processing: await seedClientConsent(
            database.db,
            userId,
            "selarti_ai_processing",
          ),
        },
      },
    };
    await database.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram','909','bot-trial-b2','909','active')`,
    );
    await database.db.execute(sql`
      insert into integration_outbox(
        idempotency_key,topic,payload,correlation_id,reconciliation_key,payload_hash
      ) values(
        ${providerRequestId},'selarti.request.v1',${JSON.stringify(payload)}::jsonb,
        'external-b2',${providerRequestId},${"4".repeat(64)}
      )`);
    const proposals = new PostgresSelartiProposalRepository(database.db);
    await seedClientRequestStarted(database.db, providerRequestId);
    await expect(
      proposals.accept({
        requestId: providerRequestId,
        dialogueId,
        threadId: providerRequestId,
        tenantKey: "bot-trial-b2",
        text: "Безопасный тестовый ответ",
        responsePayloadHash: "5".repeat(64),
        receivedAt: receivedAt.toISOString(),
      }),
    ).resolves.toBe("accepted");
    await expect(trial.summary(redemption.id)).resolves.toMatchObject({
      consumedUnits: 2,
      reservedUnits: 0,
    });
    const delivery = await database.db.execute<{ count: string }>(sql`
      select count(*)::text count from integration_outbox
      where topic='telegram.send_text.v1' and correlation_id=${providerRequestId}`);
    expect(delivery.rows[0]!.count).toBe("1");
  });
});
import {
  seedClientConsent,
  seedClientRequestStarted,
} from "../../packages/db/src/testkit/client-consent.js";
import { PostgresTestExpertTelegramRepository } from "../../packages/db/src/repositories/test-expert-telegram-repository.js";
