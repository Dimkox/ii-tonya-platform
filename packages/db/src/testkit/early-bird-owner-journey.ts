import { applyEarlyBirdDraftIfNeeded } from "./early-bird-draft-helper.js";
import { createEarlyBirdOwnerPrepareAuthority } from "../../../integrations/src/yookassa/early-bird-owner-prepare-authority.js";
import { PostgresEarlyBirdReceiptContact } from "../repositories/early-bird-receipt-contact.js";
import { createPayerReceiptVault } from "../../../integrations/src/yookassa/payer-receipt-vault.js";
import { PostgresEarlyBirdOwnerScopeSource } from "../repositories/early-bird-owner-scope-source.js";
import { randomUUID } from "node:crypto";
import { PostgresEarlyBirdOwnerSnapshotPrepare } from "../repositories/early-bird-owner-snapshot-prepare.js";
import { createEarlyBirdSnapshotSealer } from "../../../integrations/src/yookassa/early-bird-snapshot-sealer.js";
import { randomBytes } from "node:crypto";
import { ownerPricingApproval } from "./owner-pricing-approval.js";
import { bridgeEarlyBirdForm } from "../repositories/early-bird-form-bridge.js";
import { PostgresResidentReviewRepository } from "../repositories/resident-review-repository.js";
import { expect } from "vitest";
import { sql } from "drizzle-orm";
import { startExpertReferralTestDatabase } from "./expert-referral.js";
import type { ExpertReferralTestDatabase } from "./expert-referral.js";

/** Disposable, real-schema approved expert and encrypted owner invoice fixture. */
export async function createEarlyBirdOwnerJourney(
  options: {
    database?: ExpertReferralTestDatabase;
  } = {},
) {
  const db =
    options.database ??
    (await startExpertReferralTestDatabase(undefined, {
      forceDisposableCluster: true,
    }));
  try {
    await db.db.transaction(async (tx) => {
      await tx.execute(
        sql`update early_bird_launch_configs set active=false where active`,
      );
      await tx.execute(
        sql`insert into early_bird_launch_configs(phase,enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01T00:00:00+03:00','2027-01-11T00:00:00+03:00',10,'2026-12-28T10:00:00+03:00')`,
      );
    });
    // Injected fixtures own their actual isolated clock and lifecycle.
    if (!options.database)
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

    const { seedClientConsent } = await import("./client-consent.js");
    const user = await db.createUser();
    await seedClientConsent(db.db, user, "client_messaging");
    const admin = await db.createAdminAudit({
      action: "fixture",
      objectId: randomUUID(),
    });
    const approval = await ownerPricingApproval(db, {
      action: "grant",
      target: user,
      adminId: admin.adminId,
      sessionIdHash: admin.sessionIdHash,
    });
    const grant = randomUUID();
    await db.db.execute(
      sql`insert into owner_test_pricing_grants(id,user_id,granted_by,grant_session_hash,grant_approval_id) values(${grant}::uuid,${user}::uuid,${admin.adminId}::uuid,${admin.sessionIdHash},${approval}::uuid)`,
    );
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
    const choice = (
      await db.db.execute<{ id: string }>(
        sql`select id from early_bird_choices where user_id=${user}::uuid`,
      )
    ).rows[0]!.id;
    const store = new PostgresEarlyBirdOwnerSnapshotPrepare(db.db);
    const request = {
      userId: user,
      baseId: base,
      choiceId: choice,
      grantId: grant,
      operationId: randomUUID(),
      invoiceId: randomUUID(),
      idempotencyKey: randomUUID(),
      digest: `sha256:${"c".repeat(64)}`,
      ciphertext: "synthetic-sealed-request",
      keyReference: "vault:fixture",
      requestExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const key = randomBytes(32);
    const fiscal = {
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    };
    const receipt = {
      customer: { email: "fixture@example.invalid" },
      returnUrl: "https://example.invalid/return",
      onboardingFiscal: fiscal,
      subscriptionFiscal: fiscal,
    };
    let captured:
      | Parameters<ReturnType<typeof createEarlyBirdSnapshotSealer>>[0]
      | undefined;
    const sealer = createEarlyBirdSnapshotSealer({
      ...receipt,
      key,
      keyReference: "vault:fixture",
    });
    const seal = Object.assign(
      (intent: NonNullable<typeof captured>) => {
        captured = intent;
        return sealer(intent);
      },
      { fingerprint: sealer.fingerprint },
    );
    await expect(store.prepare(request, seal)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(captured).toBeUndefined();
    const source = new PostgresEarlyBirdOwnerScopeSource(
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
      telegramUserId: "123456",
      chatId: "123456",
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
      await contacts.read({ ...scope, telegramUserId: "123457" }),
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
      grantId: grant,
    });
    expect(await source.resolve(scope)).toEqual(resolved);
    expect(
      await source.resolve({ ...scope, telegramUserId: "123457" }),
    ).toBeNull();
    const authority = createEarlyBirdOwnerPrepareAuthority({
      source,
      contacts,
      store,
      key,
      keyReference: "vault:fixture",
      returnUrl: receipt.returnUrl,
      onboardingFiscal: fiscal,
      subscriptionFiscal: fiscal,
    });
    await expect(authority.prepare(scope)).resolves.toEqual({
      kind: "prepared",
    });
    await expect(authority.prepare(scope)).resolves.toEqual({ kind: "replay" });

    return {
      db,
      user,
      scope,
      identity: resolved!,
      contact: saved,
      contacts,
      source,
      key,
      fiscal,
      receipt,
      vault,
      grant,
      base,
      choice,
      authority,
    };
  } catch (error) {
    if (!options.database) await db.stop();
    throw error;
  }
}
