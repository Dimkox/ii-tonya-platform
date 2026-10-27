import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { lockCardActivationGate } from "../../packages/db/src/repositories/expert-card-repository.js";
import {
  createCorrectionOnboardingFixture,
  correctionEvent,
} from "../support/residency-correction-fixture.js";
describe("parallel application materials and proof correction (PG17.5)", () => {
  let database: ExpertReferralTestDatabase,
    f: Awaited<ReturnType<typeof createCorrectionOnboardingFixture>>;
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    f = await createCorrectionOnboardingFixture(database);
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  it("fee immediately enqueues verified promo-target materials without fabricating delivery or a card", async () => {
    const rows = (
      await database.db.execute(
        sql`select status,target_bot_id,delivery_receipt from expert_application_material_jobs where application_id=${f.applicationId}::uuid`,
      )
    ).rows;
    expect(rows).toEqual([
      {
        status: "waiting_content",
        target_bot_id: f.scope.botId,
        delivery_receipt: null,
      },
    ]);
    expect(await f.cards.getWorkflow(f.scope)).toMatchObject({
      draftId: null,
      materialStatus: "waiting_content",
      promoConfirmed: false,
    });
    expect(
      (
        await database.db.execute(
          sql`select id from expert_card_drafts where user_id=${f.userId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("accepts and manager-confirms application proof before card approval while missing assets remain honest", async () => {
    await f.cards.submitPromoProof({
      ...correctionEvent(f.scope),
      expectedRevision: 0,
      proof: { kind: "link", reference: "https://example.com/announcement" },
    });
    expect(
      await f.cards.confirmPromo({
        sessionHash: f.sessionHash,
        applicationId: f.applicationId,
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({
      draftId: null,
      materialStatus: "waiting_content",
      promoConfirmed: true,
    });
    const gate = await database.db.transaction((tx) =>
      lockCardActivationGate(tx, {
        applicationId: f.applicationId,
        userId: f.userId,
      }),
    );
    expect(gate).toBeNull();
    expect(
      (
        await database.db.execute(
          sql`select id from expert_residency_orders where expert_id in(select id from experts where user_id=${f.userId}::uuid)`,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("current approved card opens the canonical gate with confirmed proof and no forged material receipt", async () => {
    const state = await f.approveCard();
    expect(state).toMatchObject({
      status: "approved",
      promoConfirmed: true,
      materialStatus: "waiting_content",
    });
    const gate = await database.db.transaction((tx) =>
      lockCardActivationGate(tx, {
        applicationId: f.applicationId,
        userId: f.userId,
      }),
    );
    expect(gate).toMatchObject({
      applicationId: f.applicationId,
      userId: f.userId,
    });
    expect(
      (
        await database.db.execute(
          sql`select delivery_receipt from expert_application_material_jobs where application_id=${f.applicationId}::uuid`,
        )
      ).rows[0],
    ).toEqual({ delivery_receipt: null });
  });
  it("two unique referrals persist one identity-free Ready to send event without a PDF receipt", async () => {
    const code = (await f.promo.register(correctionEvent(f.scope))).refCode;
    const children = [];
    for (const external of ["91919101", "91919102"]) {
      const userId = await database.createUser();
      await database.db.execute(
        sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id,status) values(${userId}::uuid,'telegram',${external},${f.scope.botKey},${external},'active')`,
      );
      await seedClientConsent(database.db, userId, "client_messaging");
      const scope = { ...f.scope, telegramUserId: external, chatId: external };
      children.push(scope);
      await f.promo.register({ ...correctionEvent(scope), refCode: code });
    }
    await f.promo.register({ ...correctionEvent(children[0]!), refCode: code });
    const logs = (
      await database.db.execute(
        sql`select l.event,l.id,l.created_at from expert_promo_ready_logs l join expert_promo_guide_work w on w.ready_log_event_id=l.id where w.user_id=${f.userId}::uuid`,
      )
    ).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "Ready to send" });
    expect(
      (
        await database.db.execute(
          sql`select status,content_slot,delivery_receipt from expert_promo_guide_work where user_id=${f.userId}::uuid`,
        )
      ).rows[0],
    ).toEqual({
      status: "waiting_content",
      content_slot: "TODO: Wait for PDF",
      delivery_receipt: null,
    });
    const columns = (
      await database.db.execute<{ name: string }>(
        sql`select column_name as name from information_schema.columns where table_schema='public' and table_name='expert_promo_ready_logs' order by ordinal_position`,
      )
    ).rows.map((r) => r.name);
    expect(columns).toEqual(["id", "event", "created_at"]);
  });
  it("snapshots owner proof revision before asynchronous transaction work", async () => {
    const current = await f.cards.getWorkflow(f.workScope);
    if (!current) throw new Error("fixture_workflow_missing");
    const raw = {
      ...correctionEvent(f.workScope),
      expectedRevision: current.revision,
      proof: {
        kind: "link" as const,
        reference: "https://example.com/revision-snapshot",
      },
    };
    const pending = f.cards.submitPromoProof(raw);
    raw.expectedRevision = current.revision + 1;
    expect(await pending).toMatchObject({ revision: current.revision });
  });
});

describe("generic material transport before work handoff (PG17.5)", () => {
  let database: ExpertReferralTestDatabase,
    delivered: Awaited<ReturnType<typeof createCorrectionOnboardingFixture>>,
    uncertain: Awaited<ReturnType<typeof createCorrectionOnboardingFixture>>,
    healthy: Awaited<ReturnType<typeof createCorrectionOnboardingFixture>>,
    unknownCalls = 0;
  const calls: {
    botId: string;
    botKey: string;
    chatId: string;
    payload: unknown;
  }[] = [];
  beforeAll(async () => {
    database = await startExpertReferralTestDatabase();
    await database.db.execute(
      sql`insert into expert_card_material_templates(content_version,status,text_body,assets) values('generic-correction.v2','approved','Утверждённые общие материалы','[]'::jsonb)`,
    );
    delivered = await createCorrectionOnboardingFixture(database, {
      transport: {
        send: async (input) => {
          calls.push({
            botId: input.botId,
            botKey: input.botKey,
            chatId: input.chatId,
            payload: input.payload,
          });
          return {
            botId: input.botId,
            chatId: input.chatId,
            contentVersion: input.contentVersion,
            payloadDigest: input.payloadDigest,
            messageIds: ["12345"],
          };
        },
      },
    });
    uncertain = await createCorrectionOnboardingFixture(database, {
      transport: {
        send: async () => {
          unknownCalls++;
          throw new Error("synthetic_lost_response");
        },
      },
    });
    const archived = await createCorrectionOnboardingFixture(database);
    await database.db.execute(
      sql`update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 day' where id=${archived.applicationId}::uuid`,
    );
    await createCorrectionOnboardingFixture(database, {
      promoEnrollment: false,
    });
    const blocked = await createCorrectionOnboardingFixture(database);
    await database.db.execute(
      sql`update channel_identities set status='blocked' where user_id=${blocked.userId}::uuid`,
    );
    healthy = await createCorrectionOnboardingFixture(database, {
      transport: {
        send: async (input) => ({
          botId: input.botId,
          chatId: input.chatId,
          contentVersion: input.contentVersion,
          payloadDigest: input.payloadDigest,
          messageIds: ["77777"],
        }),
      },
    });
  }, 120000);
  afterAll(async () => {
    await database?.stop();
  }, 120000);
  it("withholds generic approved content from the promo identity before card approval", async () => {
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_application_material_jobs where application_id=${delivered.applicationId}::uuid`,
      )
    ).rows[0]!;
    expect(await delivered.cards.deliverMaterials(job.id)).toEqual({
      kind: "cancelled",
    });
    expect(calls).toEqual([]);
    expect(
      (
        await database.db.execute(
          sql`select id from expert_card_drafts where user_id=${delivered.userId}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(await delivered.cards.deliverMaterials(job.id)).toEqual({
      kind: "cancelled",
    });
    expect(calls).toHaveLength(0);
    expect(
      (
        await database.db.execute(
          sql`select status,attempt_id,delivery_receipt from expert_application_material_jobs where id=${job.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({
      status: "waiting_content",
      attempt_id: null,
      delivery_receipt: null,
    });
  });
  it("never attempts preapproval transport or fabricates an unknown outcome", async () => {
    const job = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_application_material_jobs where application_id=${uncertain.applicationId}::uuid`,
      )
    ).rows[0]!;
    expect(await uncertain.cards.deliverMaterials(job.id)).toEqual({
      kind: "cancelled",
    });
    expect(await uncertain.cards.deliverMaterials(job.id)).toEqual({
      kind: "cancelled",
    });
    expect(unknownCalls).toBe(0);
    expect(
      (
        await database.db.execute(
          sql`select status,attempt_id,delivery_receipt from expert_application_material_jobs where id=${job.id}::uuid`,
        )
      ).rows[0],
    ).toEqual({
      status: "waiting_content",
      attempt_id: null,
      delivery_receipt: null,
    });
  });
  it("excludes every unapproved job from dispatch even with a healthy verified promo identity", async () => {
    const expected = (
      await database.db.execute<{ id: string }>(
        sql`select id from expert_application_material_jobs where application_id=${healthy.applicationId}::uuid`,
      )
    ).rows[0]!;
    expect(await healthy.cards.listDueMaterialJobs(1)).toEqual([]);
    expect(await healthy.cards.deliverMaterials(expected.id)).toEqual({
      kind: "cancelled",
    });
  });
});
