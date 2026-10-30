import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { randomUUID, createHash } from "node:crypto";
import { PostgresExpertCardRepository } from "./expert-card-repository.js";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { YooKassaEarlyBirdCandidateVerifier } from "@ii-tonya/integrations";
import { PostgresEarlyBirdCandidateIntentReader } from "./early-bird-candidate-intent-reader.js";
import { PostgresEarlyBirdVerifiedBindingRepository } from "./early-bird-verified-binding-repository.js";
import { PostgresEarlyBirdIntentTransitions } from "./early-bird-intent-transitions.js";
import { seedEarlyBirdDraftRequest } from "../testkit/early-bird-draft-request.js";
import { ownerPricingApproval } from "../testkit/owner-pricing-approval.js";
import { bridgeEarlyBirdForm } from "./early-bird-form-bridge.js";
import { PostgresResidentReviewRepository } from "./resident-review-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";

let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  await db.db.transaction(async (tx) => {
    await tx.execute(
      sql`update early_bird_launch_configs set active=false where active`,
    );
    await tx.execute(
      sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01T00:00:00+03:00','2027-01-11T00:00:00+03:00',10,'2026-12-28T10:00:00+03:00')`,
    );
  });
  // A disposable DB runs the real phase logic against a deterministic launch-period clock.
  await db.db.execute(
    sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
  );
  await applyEarlyBirdDraftIfNeeded(
    db.db,
    "docs/superpowers/implementation-artifacts/drafts/0081_early_bird_composite.sql",
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("rejects confirming or reserving a previously seen slot after refund", async () => {
  const { seedClientConsent } = await import("../testkit/client-consent.js");
  const user = await db.createUser();
  await seedClientConsent(db.db, user, "client_messaging");
  await db.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values (${user}::uuid,'telegram','123456','fixture-bot','123456')`,
  );
  await db.db.execute(
    sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values (${user}::uuid,1,'fixture',false,'offline',300000,'expert','fixture-profile')`,
  );
  const tariff = await db.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 1000000,
    durationSeconds: 2592000,
  });
  const base = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','fixture-bot','123456','client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
  );
  const admin = await db.createAdminAudit({
    action: "fixture",
    objectId: randomUUID(),
  });
  const grantApproval = await ownerPricingApproval(db, {
    action: "grant",
    target: user,
    adminId: admin.adminId,
    sessionIdHash: admin.sessionIdHash,
  });
  const grant = randomUUID();
  await db.db.execute(
    sql`insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values(${grant}::uuid,${user}::uuid,${admin.adminId}::uuid,${admin.sessionIdHash},${grantApproval}::uuid)`,
  );
  const positive = randomUUID();
  await db.db.execute(
    sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values (${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
  );
  await db.db.execute(
    sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${positive}::uuid,${user}::uuid,${base}::uuid,${grant}::uuid)`,
  );
  await db.db.execute(
    sql`insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${user}::uuid,${base}::uuid,${positive}::uuid,1,'now','wave-1',${"b".repeat(64)})`,
  );
  const form = (
    await db.db.execute<{ id: string }>(
      sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) select ${user}::uuid,'1','fixture-bot',id,'123456','123456' from channel_identities where user_id=${user}::uuid returning id`,
    )
  ).rows[0]!.id;
  await db.db.execute(
    sql`insert into early_bird_form_enrollments(form_id,user_id,choice_id) select ${form}::uuid,${user}::uuid,id from early_bird_choices where user_id=${user}::uuid`,
  );
  const draft = {
    roles: ["EXPERT"],
    primaryRole: "EXPERT",
    category: "BASIC",
    tax: "SELF_EMPLOYED",
    city: "Казань",
    socialLinks: ["https://example.com"],
    motivation: "Работа",
    specialization: "Психология",
    averageCheckMinor: "300000",
    methods: "Практика",
    experienceYears: 5,
    cases: "Пример",
  };
  await db.db.execute(
    sql`update residents_applications set draft=${JSON.stringify(draft)}::jsonb,submitted_draft=${JSON.stringify(draft)}::jsonb,submitted_at=clock_timestamp(),status='UNDER_REVIEW',progress='AUTO_CHECK',revision=revision+1 where id=${form}::uuid`,
  );
  const result = await db.db.transaction((tx) =>
    bridgeEarlyBirdForm(tx, user, form, 1),
  );
  expect(result).toBeTruthy();
  const manager = await db.createUser();
  const session = `test-review-${randomUUID()}`;
  await db.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await db.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
  );
  const review = new PostgresResidentReviewRepository(db.db, {
    providerMode: "test",
    messagingConsentPolicyVersion: "client-messaging-v1",
    earlyBirdReview: true,
  });
  const operation = randomUUID(),
    invoice = randomUUID(),
    idem = randomUUID();
  const insertIntent = () =>
    db.db.execute(
      sql`insert into early_bird_composite_intents(id,invoice_id,user_id,base_id,choice_id,grant_id,config_id,pricing_policy,idempotency_key,onboarding_minor,subscription_minor,total_minor,base_offer_shown_at,expires_at,launch_at,request_digest) select ${operation}::uuid,${invoice}::uuid,b.user_id,b.id,c.id,${grant}::uuid,cfg.id,'owner_test_10_20_v1',${idem}::uuid,1000,2000,3000,b.base_offer_shown_at,b.base_offer_shown_at+interval '240 hours',cfg.client_start_at,${`sha256:${"c".repeat(64)}`} from expert_sales_bases b join early_bird_choices c on c.base_id=b.id and c.user_id=b.user_id join early_bird_launch_configs cfg on cfg.active where b.id=${base}::uuid`,
    );
  await expect(insertIntent()).rejects.toThrow();
  const preview = await review.preview(session, {
    applicationId: result!,
    key: "APPROVED_BASIC",
    expectedRevision: 1,
    expectedGeneration: 1,
  });
  const confirmed = await review.confirm(
    session,
    result!,
    preview.previewId,
    preview.hash,
  );
  expect(confirmed.action).toBe("APPROVED_BASIC");
  await expect(insertIntent()).resolves.toBeDefined();
  await seedEarlyBirdDraftRequest(db.db, {
    intentId: operation,
    userId: user,
    idempotencyKey: idem,
    digest: `sha256:${"c".repeat(64)}`,
  });
  expect(
    await new PostgresEarlyBirdIntentTransitions(db.db).markUnknown({
      userId: user,
      intentId: operation,
    }),
  ).toBe(true);
  await db.db.execute(
    sql`create role ii_tonya_wave_verifier nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`create role ii_tonya_wave_intent_reader nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`create role wave_writer_10_20 login password 'synthetic-writer' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(
    sql`create role wave_reader_10_20 login password 'synthetic-reader' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await db.db.execute(sql`grant ii_tonya_wave_verifier to wave_writer_10_20`);
  await db.db.execute(
    sql`grant ii_tonya_wave_intent_reader to wave_reader_10_20`,
  );
  await db.db.execute(
    sql`grant usage on schema early_bird_private to wave_writer_10_20, wave_reader_10_20`,
  );
  await db.db.execute(
    sql`grant execute on function early_bird_private.bind_verified(uuid,uuid,text,text,jsonb) to wave_writer_10_20`,
  );
  await db.db.execute(
    sql`grant execute on function early_bird_private.find_candidate_intent(uuid) to wave_reader_10_20`,
  );
  const url = new URL(db.db.$client.options.connectionString!);
  url.username = "wave_reader_10_20";
  url.password = "synthetic-reader";
  const readerPool = new Pool({ connectionString: url.toString() });
  url.username = "wave_writer_10_20";
  url.password = "synthetic-writer";
  const writerPool = new Pool({ connectionString: url.toString() });
  try {
    const reader = new PostgresEarlyBirdCandidateIntentReader(
      drizzle(readerPool) as never,
      "wave_reader_10_20",
    );
    const verifier = new YooKassaEarlyBirdCandidateVerifier(
      {
        getPayment: async () => ({
          id: "payment_30",
          status: "pending",
          paid: false,
          test: false,
          amount: { value: "30.00", currency: "RUB" },
          createdAt: new Date().toISOString(),
          metadata: {
            order_id: invoice,
            user_id: user,
            operation_id: operation,
            purpose: "combined_early_bird",
            pricing_policy: "owner_test_10_20_v1",
            price_kind: "fixed_test",
            pricing_grant_id: grant,
          },
        }),
      } as never,
      reader,
    );
    const proof = await verifier.verify(operation, "payment_30");
    expect(proof).toMatchObject({
      onboardingMinor: "1000",
      subscriptionMinor: "2000",
      totalMinor: "3000",
    });
    await new PostgresEarlyBirdVerifiedBindingRepository(
      drizzle(writerPool) as never,
      verifier,
      "wave_writer_10_20",
    ).bind(proof);
    await applyEarlyBirdDraftIfNeeded(
      db.db,
      "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql",
    );
    await applyEarlyBirdDraftIfNeeded(
      db.db,
      "docs/superpowers/implementation-artifacts/drafts/wave_workspace_gate.sql",
    );
    const workspace = async () =>
      (
        await db.db.execute<{ application: string | null }>(
          sql`select early_bird_paid_workspace(${user}::uuid) as application`,
        )
      ).rows[0]!.application;
    expect(await workspace()).toBeNull();
    const captured = new Date();
    await db.db.execute(
      sql`select early_bird_record_success(${operation}::uuid,${user}::uuid,'payment_30',${`sha256:${"e".repeat(64)}`},${captured})`,
    );
    expect(await workspace()).toBe(result);
    await applyEarlyBirdDraftIfNeeded(
      db.db,
      "docs/superpowers/implementation-artifacts/drafts/wave_admission_projection.sql",
    );
    const cards = new PostgresExpertCardRepository(db.db, {
      waveWorkspace: true,
      richOnboarding: true,
      photoCustody: {
        read: async () => new Uint8Array([1]),
        put: async () => true,
        presign: async (i) =>
          "https://example.com/private-photo/" + i.custodyId,
      },
      messagingConsentPolicyVersion: "client-messaging-v1",
      workBotId: "2",
      workBotKey: "fixture-work",
    });
    const key = "1:100";
    const handoff = await cards.issueWorkHandoff({
      botId: "1",
      botKey: "fixture-bot",
      telegramUserId: "123456",
      chatId: "123456",
      requestKey: key,
      requestDigest: createHash("sha256").update(key).digest("hex"),
    });
    expect(handoff.kind).toBe("issued");
    if (handoff.kind !== "issued") throw Error("handoff_not_issued");
    let sequence = 100;
    const workEvent = () => {
      const requestKey = `2:${++sequence}`;
      return {
        botId: "2",
        botKey: "fixture-work",
        telegramUserId: "123456",
        chatId: "123456",
        requestKey,
        requestDigest: createHash("sha256").update(requestKey).digest("hex"),
      };
    };
    await cards.redeemWorkHandoff({ ...workEvent(), token: handoff.token });
    const scope = {
      botId: "2",
      botKey: "fixture-work",
      telegramUserId: "123456",
      chatId: "123456",
    };
    const revision = async () => (await cards.getWorkflow(scope))!.revision;
    const photos: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = workEvent();
      const reference = `telegram:file:wave_booking_${i}`;
      const entry = await cards.addEntry({
        ...e,
        expectedRevision: await revision(),
        entry: { kind: "photo", reference },
      });
      photos.push(
        (
          await cards.ingestRichPhoto({
            ...e,
            expectedRevision: entry.revision,
            reference,
            size: 1,
            mimeType: "image/jpeg",
          })
        ).id,
      );
    }
    const bio =
      "Помогаю разобраться в жизненных задачах и выбрать собственные следующие шаги без обещаний результата.";
    await cards.richAction({
      ...workEvent(),
      expectedRevision: await revision(),
      action: "patch",
      value: {
        fullName: "Мария",
        specialization: "Консультант",
        bio,
        socialLinks: ["https://example.com/profile"],
        photos,
        onlineRoomType: "STATIC_LINK",
        staticRoomLink: "https://example.com/room",
        services: [
          {
            id: randomUUID(),
            title: "Консультация",
            format: "ONLINE",
            eventDelivery: null,
            durationMinutes: 60,
            price: { kind: "exact", minRub: "1000.00", maxRub: null },
            description: bio,
            audience: "Взрослые",
            result: "План",
            expiryDate: null,
            detailsUrl: null,
            tags: ["#тревожность"],
          },
        ],
      },
    });
    const send = async (text: string) =>
      (await cards.scheduleAction({ ...workEvent(), text })).pageText;
    await send("/slots_setup");
    for (const answer of [
      "Etc/UTC",
      "2027-01-15 2027-01-15",
      "1 2 3 4 5 6 7",
      "09:00-14:00",
      "нет",
      "15",
    ])
      await send("/slots_answer " + answer);
    let page = await send("/slots_preview");
    while (page.split("\n").at(-1)!.startsWith("/slots_page"))
      page = await send(page.split("\n").at(-1)!);
    await send(page.split("\n").at(-1)!);
    let rev = await revision();
    rev = (
      await cards.editPublicCard({
        sessionHash: session,
        applicationId: result!,
        expectedRevision: rev,
        idempotencyKey: randomUUID(),
        publicCard: {
          displayName: "Мария",
          profession: "Консультант",
          city: "Казань",
          summary: bio,
        },
      })
    ).revision;
    let previewCard = await cards.richAction({
      ...workEvent(),
      expectedRevision: rev,
      action: "preview",
    });
    while (
      previewCard.pageText!.split("\n").at(-1)!.startsWith("/card_preview")
    ) {
      const parts = previewCard.pageText!.split("\n").at(-1)!.split(" ");
      previewCard = await cards.richAction({
        ...workEvent(),
        expectedRevision: rev,
        action: "preview",
        page: Number(parts[2]),
        token: parts[3]!,
      });
    }
    await cards.richAction({
      ...workEvent(),
      expectedRevision: rev,
      action: "confirm",
      token: previewCard.pageText!.split(" ").at(-1)!,
    });
    await cards.submitDraft({ ...workEvent(), expectedRevision: rev });
    const detail = (await cards.readDraft(session, result!))!;
    const approved = await cards.reviewCard({
      sessionHash: session,
      applicationId: result!,
      expectedRevision: rev,
      idempotencyKey: randomUUID(),
      action: "approve",
      warningAcknowledgment: detail.safety.digest,
    });
    expect(approved).toBeDefined();
    const card = await db.db.execute(
      sql`select status, approved_review_id as review from expert_card_drafts where user_id=${user}::uuid`,
    );
    expect(card.rows[0]?.status).toBe("approved");

    // This test owns an isolated disposable cluster and advances its database
    // clock only after the pre-launch payment and approval have completed.
    await db.db.execute(
      sql`create or replace function pg_catalog.clock_timestamp() returns timestamptz language sql volatile as $$ select '2027-01-11T00:00:01+03:00'::timestamptz $$`,
    );
    await db.db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level serializable`);
      await tx.execute(
        sql`select public.early_bird_activate_projection(${user}::uuid,${operation}::uuid)`,
      );
    });
    const published = await db.db.execute(
      sql`select active,wave_intent_id as intent,paid_order_id as legacy from experts_published where user_id=${user}::uuid`,
    );
    expect(published.rows[0]).toMatchObject({
      active: true,
      intent: operation,
      legacy: null,
    });
    const visible = await db.db.execute(
      sql`select early_bird_current_publication_valid(e.id) as valid from experts e where e.user_id=${user}::uuid`,
    );
    expect(visible.rows[0]?.valid).toBe(true);
    const { PostgresBookingRepository } =
      await import("./booking-repository.js");
    const clientId = await db.createUser();
    await seedClientConsent(db.db, clientId, "client_messaging");
    const booking = new PostgresBookingRepository(db.db, {
      waveCoverage: true,
    });
    const now = new Date("2027-01-10T21:00:01Z");
    const slots = await booking.searchSlots({
      from: new Date("2027-01-14T00:00:00Z"),
      to: new Date("2027-01-17T00:00:00Z"),
      now,
      minimumLeadMs: 0,
    });
    expect(slots.length).toBeGreaterThan(0);
    const held = await booking.reserve({
      userId: clientId,
      slotId: slots[0]!.slotId,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      now,
      minimumLeadMs: 0,
      confirmationBufferMs: 900000,
    });
    expect(held.kind).toBe("reserved");
    if (held.kind !== "reserved") throw new Error("wave_booking_missing");
    await db.db.execute(
      sql`select early_bird_record_full_refund(${operation}::uuid,${user}::uuid,'refund_30',${`sha256:${"f".repeat(64)}`},3000::bigint,${captured})`,
    );
    await expect(
      booking.transition({
        reservationId: held.reservationId,
        expectedVersion: held.version,
        action: "expert_confirm",
        actor: { type: "expert", id: slots[0]!.expertId },
        now,
        correlationId: randomUUID(),
      }),
    ).rejects.toThrow("Native slot authority expired");
    const laterClient = await db.createUser();
    await seedClientConsent(db.db, laterClient, "client_messaging");
    const later = await booking.reserve({
      userId: laterClient,
      slotId: slots.at(-1)!.slotId,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      now,
      minimumLeadMs: 0,
      confirmationBufferMs: 900000,
    });
    expect(later.kind).toBe("unavailable");
    expect(await workspace()).toBeNull();
    expect(
      await booking.searchSlots({
        from: new Date("2027-01-14T00:00:00Z"),
        to: new Date("2027-01-17T00:00:00Z"),
        now,
        minimumLeadMs: 0,
      }),
    ).toEqual([]);
    const rejected = await db.db.execute(
      sql`select resident_native_admission(e.id) as admitted from experts e where e.user_id=${user}::uuid`,
    );
    expect(rejected.rows[0]?.admitted).toBe(false);
    expect(
      (
        await db.db.execute(
          sql`select provider_object_id from early_bird_verified_bindings where intent_id=${operation}::uuid`,
        )
      ).rows,
    ).toEqual([{ provider_object_id: "payment_30" }]);
  } finally {
    await readerPool.end();
    await writerPool.end();
  }
}, 120_000);
