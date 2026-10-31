import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { createEarlyBirdStandardPrepareAuthority } from "../../../integrations/src/yookassa/early-bird-standard-prepare-authority.js";
import { PostgresEarlyBirdReceiptContact } from "./early-bird-receipt-contact.js";
import { createPayerReceiptVault } from "../../../integrations/src/yookassa/payer-receipt-vault.js";
import { PostgresEarlyBirdStandardScopeSource } from "./early-bird-standard-scope-source.js";
import { randomUUID } from "node:crypto";
import { PostgresEarlyBirdStandardSnapshotPrepare } from "./early-bird-standard-snapshot-prepare.js";
import { randomBytes } from "node:crypto";
import { bridgeEarlyBirdForm } from "./early-bird-form-bridge.js";
import { PostgresResidentReviewRepository } from "./resident-review-repository.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";

let db: ExpertReferralTestDatabase;
let sharedTariff: string | undefined;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
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
  await applyEarlyBirdDraftIfNeeded(
    db.db,
    "docs/superpowers/implementation-artifacts/drafts/0087_early_bird_receipt_contacts.sql",
  );
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it.each(["discounted", "full"] as const)(
  "prepares standard %s price from an authenticated encrypted wave contact",
  async (priceKind) => {
    await db.db.execute(
      sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-02T00:00:00+03:00'::timestamptz $$`,
    );
    const { seedClientConsent } = await import("../testkit/client-consent.js");
    const chat = priceKind === "full" ? "123457" : "123456";
    const user = await db.createUser();
    await seedClientConsent(db.db, user, "client_messaging");
    await db.db.execute(
      sql`insert into channel_identities(user_id,provider,external_id,bot_key,external_chat_id) values (${user}::uuid,'telegram',${chat},'fixture-bot',${chat})`,
    );
    await db.db.execute(
      sql`insert into expert_offer_profiles(user_id,revision,city_code,million_city,service_format,ticket_minor,participant_kind,idempotency_key) values (${user}::uuid,1,'fixture',false,'offline',300000,'expert','fixture-profile')`,
    );
    const tariff = (sharedTariff ??= await db.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 1000000,
      durationSeconds: 2592000,
    }));
    const base = randomUUID();
    await db.db.execute(
      sql`insert into expert_sales_bases(id,user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) select ${base}::uuid,${user}::uuid,t.id,1,greatest(500000,t.price_minor),'expert','1','fixture-bot',${chat},'client-messaging-v1' from expert_residency_tariff_versions t where t.id=${tariff}::uuid`,
    );
    const positive = randomUUID();
    await db.db.execute(
      sql`insert into expert_sales_choices(id,base_id,user_id,revision,action,request_key,request_digest) values (${positive}::uuid,${base}::uuid,${user}::uuid,1,'positive','positive-1',${"a".repeat(64)})`,
    );
    await db.db.execute(
      sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${positive}::uuid,${user}::uuid,${base}::uuid,null)`,
    );
    await db.db.execute(
      sql`insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) values(${user}::uuid,${base}::uuid,${positive}::uuid,1,'now','wave-1',${"b".repeat(64)})`,
    );
    const form = (
      await db.db.execute<{ id: string }>(
        sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) select ${user}::uuid,'1','fixture-bot',id,${chat},${chat} from channel_identities where user_id=${user}::uuid returning id`,
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
    const choice = (
      await db.db.execute<{ id: string }>(
        sql`select id from early_bird_choices where user_id=${user}::uuid`,
      )
    ).rows[0]!.id;
    const store = new PostgresEarlyBirdStandardSnapshotPrepare(db.db);
    const key = randomBytes(32);
    const fiscal = {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    };
    const receipt = { returnUrl: "https://example.invalid/return" };
    const source = new PostgresEarlyBirdStandardScopeSource(
      db.db,
      {
        botId: "1",
        botKey: "fixture-bot",
        messagingConsentPolicyVersion: "client-messaging-v1",
      },
      Buffer.alloc(32, 7),
    );
    const scope = {
      botId: "1",
      botKey: "fixture-bot",
      telegramUserId: chat,
      chatId: chat,
      offerId: base,
      choiceId: choice,
    };
    expect(await source.resolve(scope)).toBeNull();
    const preview = await review.preview(session, {
      applicationId: result!,
      key: "APPROVED_BASIC",
      expectedRevision: 1,
      expectedGeneration: 1,
    });
    await review.confirm(session, result!, preview.previewId, preview.hash);
    if (priceKind === "full")
      await db.db.execute(
        sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-12T00:00:00+03:00'::timestamptz $$`,
      );
    const vault = createPayerReceiptVault({
      activeKeyId: "fixture",
      keys: new Map([["fixture", Buffer.alloc(32, 3)]]),
    });
    const contacts = new PostgresEarlyBirdReceiptContact(db.db, source, vault);
    const saved = await contacts.capture(
      scope,
      "fixture@example.invalid",
      "receipt-1",
    );
    expect(
      await contacts.capture(scope, "fixture@example.invalid", "receipt-1"),
    ).toEqual(saved);
    await expect(
      contacts.capture(scope, "other@example.invalid", "receipt-1"),
    ).rejects.toThrow();
    expect(await contacts.read(scope)).toEqual({
      id: saved.id,
      email: "fixture@example.invalid",
      expiresAt: saved.expiresAt,
    });
    expect(
      await contacts.read({ ...scope, telegramUserId: "999999" }),
    ).toBeNull();
    const contactRows = await db.db.execute<{ ciphertext: string }>(
      sql`select ciphertext from early_bird_receipt_contacts where id=${saved.id}::uuid`,
    );
    expect(contactRows.rows[0]!.ciphertext).not.toContain(
      "fixture@example.invalid",
    );
    await expect(
      db.db.execute(
        sql`delete from early_bird_receipt_contacts where id=${saved.id}::uuid`,
      ),
    ).rejects.toThrow();
    const resolved = await source.resolve(scope);
    expect(resolved).toMatchObject({
      userId: user,
      baseId: base,
      choiceId: choice,
    });
    expect(await source.resolve(scope)).toEqual(resolved);
    expect(
      await source.resolve({ ...scope, telegramUserId: "999999" }),
    ).toBeNull();
    const authority = createEarlyBirdStandardPrepareAuthority({
      source,
      contacts,
      store,
      key,
      keyReference: "vault:fixture",
      returnUrl: receipt.returnUrl,
      onboardingFiscal: fiscal,
      subscriptionFiscal: fiscal,
      mode: "live",
    });
    await expect(authority.prepare(scope)).resolves.toEqual({
      kind: "prepared",
    });
    await expect(authority.prepare(scope)).resolves.toEqual({ kind: "replay" });
    const savedIntent = await db.db.execute<{ total: string }>(
      sql`select total_minor::text as total from early_bird_composite_intents where user_id=${user}::uuid`,
    );
    const baseAmount = BigInt(
      (
        await db.db.execute<{ base: string }>(
          sql`select base_tariff_amount::text as base from expert_sales_bases where id=${base}::uuid`,
        )
      ).rows[0]!.base,
    );
    const monthly =
      priceKind === "full" ? baseAmount : (baseAmount * 6000n + 5000n) / 10000n;
    expect(savedIntent.rows).toEqual([
      { total: (monthly + 300000n).toString() },
    ]);
    const requestRows = await db.db.execute(
      sql`select r.intent_id from early_bird_composite_requests r join early_bird_composite_intents i on i.id=r.intent_id where i.user_id=${user}::uuid`,
    );
    expect(requestRows.rows).toHaveLength(1);
  },
  120_000,
);
