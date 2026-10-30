import type { PayerReceiptVault } from "@ii-tonya/integrations";
import { PostgresPayerReceiptContactRepository } from "./payer-receipt-contact-repository.js";
import { sql } from "drizzle-orm";
import {
  calculateExpertBasePrice,
  calculateSeparatedSalesTerms,
} from "@ii-tonya/domain";
import type { DrizzleDb } from "../client.js";
import {
  lockClientConsentSubject,
  captureClientConsentAuthority,
} from "./client-consent-authority.js";
import type { ExpertPromoCommand } from "./expert-promo-repository.js";
export interface SeparatedSalesView {
  id: string;
  revision: number;
  baseMonthlyMinor: string;
  firstOfferAt: string;
  state: "qualification" | "base" | "promotion" | "period" | "form" | "locked";
  promotion: boolean | null;
  monthlyPriceMinor: string | null;
  packagePriceMinor: string | null;
  selectedTotalMinor: string | null;
  termMonths: 1 | 3 | null;
  expiresAt: string | null;
  remainingSeconds?: number;
  invoiceId?: string;
  operationId?: string;
  submitted?: boolean;
  standardOnly: boolean;
  replay: boolean;
  waveTestPrice?: {
    grantId: string;
    onboardingMinor: string;
    subscriptionMinor: string;
  };
  tariffs?: { id: string; name: string }[];
}
type Tx = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
export class PostgresExpertSeparatedSalesRepository {
  constructor(
    private readonly db: DrizzleDb,
    private readonly policy: {
      botId: string;
      botKey: string;
      messagingConsentPolicyVersion: string;
    },
  ) {}
  async captureReceipt(
    input: ExpertPromoCommand & { email: string },
    vault: PayerReceiptVault,
    retentionDays: number,
  ) {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.chatId !== input.telegramUserId
    )
      throw new Error("expert_sales_identity");
    return this.db.transaction(async (tx) => {
      const rows = (
        await tx.execute<{ userId: string }>(
          sql`select user_id as "userId" from channel_identities where provider='telegram' and bot_key=${input.botKey} and external_id=${input.telegramUserId} and external_chat_id=${input.chatId} and status='active' limit 2`,
        )
      ).rows;
      if (rows.length !== 1) throw new Error("expert_sales_identity");
      const userId = rows[0]!.userId;
      await lockClientConsentSubject(tx, userId);
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: input.botKey,
          chatId: input.chatId,
          externalUserId: input.telegramUserId,
          messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
        }))
      )
        throw new Error("expert_sales_identity");
      const b = (
        await tx.execute<{ quote: string }>(
          sql`select quote_id quote from expert_sales_form_bridges where user_id=${userId}::uuid and expert_sales_receipt_authority(quote_id,user_id)`,
        )
      ).rows[0];
      if (!b) throw new Error("expert_sales_receipt_unavailable");
      return new PostgresPayerReceiptContactRepository(
        this.db,
        vault,
        retentionDays,
      ).capture(
        {
          userId,
          quoteId: b.quote,
          email: input.email,
          idempotencyKey: input.requestKey,
        },
        tx,
      );
    });
  }
  async transition(
    input: ExpertPromoCommand & {
      tariffVersionId?: string;
      action?: "positive" | "promo" | "base" | "month" | "quarter";
      baseId?: string;
      revision?: number;
      /** Internal wave-only transition; no legacy choice is made after client launch. */
      waveStartAtMs?: number;
      waveEnrollmentStartMs?: number;
      waveExpectedGrantId?: string | null;
    },
  ): Promise<SeparatedSalesView | null> {
    if (
      input.botId !== this.policy.botId ||
      input.botKey !== this.policy.botKey ||
      input.chatId !== input.telegramUserId ||
      !/^[1-9][0-9]{0,19}$/u.test(input.chatId) ||
      !/^[0-9a-f]{64}$/u.test(input.requestDigest) ||
      !/^[A-Za-z0-9._:-]{1,200}$/u.test(input.requestKey) ||
      (input.waveStartAtMs === undefined) !==
        (input.waveEnrollmentStartMs === undefined) ||
      (input.waveStartAtMs !== undefined &&
        ((input.action !== "positive" &&
          !(input.action === undefined && input.tariffVersionId)) ||
          !Number.isSafeInteger(input.waveStartAtMs) ||
          input.waveStartAtMs !== Date.parse("2027-01-11T00:00:00+03:00") ||
          input.waveEnrollmentStartMs !==
            Date.parse("2026-11-01T00:00:00+03:00") ||
          (input.action === "positive" &&
            input.waveExpectedGrantId === undefined) ||
          (typeof input.waveExpectedGrantId === "string" &&
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
              input.waveExpectedGrantId,
            ))))
    )
      throw new Error("expert_sales_identity");
    return this.db.transaction(async (tx) => {
      const identities = (
        await tx.execute<{ id: string }>(
          sql`select u.id from channel_identities ci join users u on u.id=ci.user_id and u.active where ci.provider='telegram' and ci.bot_key=${input.botKey} and ci.external_id=${input.telegramUserId} and ci.external_chat_id=${input.chatId} and ci.status='active' limit 2`,
        )
      ).rows;
      if (identities.length !== 1) throw new Error("expert_sales_identity");
      const userId = identities[0]!.id;
      await lockClientConsentSubject(tx, userId);
      if (input.waveStartAtMs !== undefined) {
        // Hold the active configuration row until this transaction commits so a
        // concurrent phase change cannot race a new choice or its replay.
        const config = await tx.execute(
          sql`select 1 from early_bird_launch_configs where active and phase='WAVE_1_EARLY_BIRD' and enrollment_start_at=${new Date(input.waveEnrollmentStartMs!).toISOString()}::timestamptz and client_start_at=${new Date(input.waveStartAtMs).toISOString()}::timestamptz and promo_deadline_days=10 and final_call_trigger_at='2026-12-28 07:00:00+00'::timestamptz for share`,
        );
        if (config.rows.length !== 1)
          throw new Error("early_bird_phase_closed");
        const active = await tx.execute(
          sql`select 1 where early_bird_wave_active(early_bird_current_time())`,
        );
        if (active.rows.length !== 1)
          throw new Error("early_bird_phase_closed");
      }
      if (
        (
          await tx.execute(
            sql`select 1 from expert_sales_erased_cohorts where user_id=${userId}::uuid`,
          )
        ).rows.length
      )
        throw new Error("expert_sales_identity");
      if (
        !(await captureClientConsentAuthority(tx, {
          subjectId: userId,
          botKey: input.botKey,
          chatId: input.chatId,
          externalUserId: input.telegramUserId,
          messagingPolicyVersion: this.policy.messagingConsentPolicyVersion,
        }))
      )
        throw new Error("expert_sales_identity");
      const testPrice =
        input.waveStartAtMs === undefined
          ? undefined
          : (
              await tx.execute<{
                id: string;
                onboarding: string;
                subscription: string;
              }>(
                sql`select id, onboarding_minor::text onboarding, subscription_minor::text subscription from owner_test_pricing_grants where user_id=${userId}::uuid and revoked_at is null and provider_mode='live' and policy_version='owner_test_10_20_v1' for share`,
              )
            ).rows[0];
      if (
        input.waveStartAtMs !== undefined &&
        input.action === "positive" &&
        (testPrice?.id ?? null) !== input.waveExpectedGrantId
      )
        throw new Error("early_bird_price_changed");
      let b = (
        await tx.execute<{
          id: string;
          amount: string;
          first: string;
          kind: "expert" | "space";
        }>(
          sql`select id,base_tariff_amount::text amount,base_offer_shown_at::text first,participant_kind kind from expert_sales_bases where user_id=${userId}::uuid`,
        )
      ).rows[0];
      if (!b) {
        if (
          (
            await tx.execute(
              sql`select 1 from expert_campaign_quotes where user_id=${userId}::uuid union all select 1 from expert_onboarding_invoices where user_id=${userId}::uuid limit 1`,
            )
          ).rows.length
        )
          return null;
        if (!input.tariffVersionId)
          return {
            id: "",
            revision: 0,
            baseMonthlyMinor: "0",
            firstOfferAt: "",
            state: "qualification",
            promotion: null,
            monthlyPriceMinor: null,
            packagePriceMinor: null,
            selectedTotalMinor: null,
            termMonths: null,
            expiresAt: null,
            standardOnly: false,
            replay: false,
            tariffs: (
              await tx.execute<{ id: string; name: string }>(
                sql`select id,display_name name from expert_residency_tariff_versions where commercial_policy_version='expert_residency_v2' and active_from<=clock_timestamp() and active_to>clock_timestamp() order by id limit 10`,
              )
            ).rows,
          };
        const p = (
          await tx.execute<{
            revision: number;
            million: boolean;
            format: string;
            ticket: string;
            kind: "expert" | "space";
          }>(
            sql`select revision,million_city million,service_format format,ticket_minor::text ticket,participant_kind kind from expert_offer_profiles where user_id=${userId}::uuid order by revision desc limit 1`,
          )
        ).rows[0];
        const t = (
          await tx.execute<{ amount: string }>(
            sql`select price_minor::text amount from expert_residency_tariff_versions where id=${input.tariffVersionId}::uuid`,
          )
        ).rows[0];
        if (!p || !t) throw new Error("expert_sales_qualification_required");
        const amount = calculateExpertBasePrice({
          categoryRateMinor: BigInt(t.amount),
          millionCity: p.million,
          onlineOnly: p.format === "online_only",
          ticketMinor: BigInt(p.ticket),
        });
        b = (
          await tx.execute<{
            id: string;
            amount: string;
            first: string;
            kind: "expert" | "space";
          }>(
            sql`insert into expert_sales_bases(user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) values(${userId}::uuid,${input.tariffVersionId}::uuid,${p.revision},${amount.toString()}::bigint,${p.kind},${input.botId},${input.botKey},${input.chatId},${this.policy.messagingConsentPolicyVersion}) returning id,base_tariff_amount::text amount,base_offer_shown_at::text first,participant_kind kind`,
          )
        ).rows[0]!;
      }
      let replay = false;
      const latest = async () =>
        (
          await tx.execute<{ id: string; revision: number; action: string }>(
            sql`select id,revision,action from expert_sales_choices where base_id=${b!.id}::uuid order by revision desc limit 1`,
          )
        ).rows[0];
      let c = await latest();
      if (input.action) {
        if (input.baseId !== b.id) throw new Error("expert_sales_stale_choice");
        const prior = (
          await tx.execute<{
            action: string;
            digest: string;
            revision: number;
          }>(
            sql`select action,request_digest digest,revision from expert_sales_choices where base_id=${b.id}::uuid and request_key=${input.requestKey}`,
          )
        ).rows[0];
        if (prior) {
          if (
            prior.action !== input.action ||
            prior.digest !== input.requestDigest ||
            prior.revision !== input.revision! + 1
          )
            throw new Error("expert_sales_replay_conflict");
          if (input.waveStartAtMs !== undefined) {
            if (!c || c.revision !== prior.revision || c.action !== "positive")
              throw new Error("expert_sales_stale_choice");
            const saved = await tx.execute(
              sql`select 1 from early_bird_positive_price_snapshots where positive_choice_id=${c.id}::uuid and user_id=${userId}::uuid and base_id=${b.id}::uuid and grant_id is not distinct from ${input.waveExpectedGrantId}::uuid`,
            );
            if (saved.rows.length !== 1)
              throw new Error("early_bird_price_changed");
          }
          replay = true;
        } else {
          if ((c?.revision ?? 0) !== input.revision)
            throw new Error("expert_sales_stale_choice");
          const inserted = await tx.execute(
            input.waveStartAtMs === undefined
              ? sql`insert into expert_sales_choices(base_id,user_id,revision,action,request_key,request_digest) values(${b.id}::uuid,${userId}::uuid,${input.revision! + 1},${input.action},${input.requestKey},${input.requestDigest}) returning id`
              : sql`insert into expert_sales_choices(base_id,user_id,revision,action,request_key,request_digest) select ${b.id}::uuid,${userId}::uuid,${input.revision! + 1},${input.action},${input.requestKey},${input.requestDigest} where early_bird_wave_active(early_bird_current_time()) returning id`,
          );
          if (inserted.rows.length !== 1)
            throw new Error("early_bird_phase_closed");
          c = await latest();
          if (
            input.waveStartAtMs !== undefined &&
            input.action === "positive"
          ) {
            if (
              !c ||
              c.action !== "positive" ||
              c.revision !== input.revision! + 1
            )
              throw new Error("expert_sales_stale_choice");
            await tx.execute(
              sql`insert into early_bird_positive_price_snapshots(positive_choice_id,user_id,base_id,grant_id) values(${c.id}::uuid,${userId}::uuid,${b.id}::uuid,${input.waveExpectedGrantId}::uuid)`,
            );
          }
          if (input.action === "month" || input.action === "quarter") {
            const promo = (
              await tx.execute<{ yes: boolean }>(
                sql`select action='promo' yes from expert_sales_choices where base_id=${b.id}::uuid and revision<${c!.revision} and action in('promo','base') order by revision desc limit 1`,
              )
            ).rows[0]!.yes;
            const now = Number(
              (
                await tx.execute<{ ms: string }>(
                  sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
                )
              ).rows[0]!.ms,
            );
            const terms = calculateSeparatedSalesTerms({
              baseMonthlyMinor: BigInt(b.amount),
              participantKind: b.kind,
              firstOfferAtMs: Date.parse(b.first),
              quotedAtMs: now,
              promotion: promo,
              termMonths: input.action === "month" ? 1 : 3,
            });
            await tx.execute(
              sql`insert into expert_sales_selections(base_id,user_id,choice_id,promo_accepted_flag,term_months,monthly_price_minor,package_price_minor,selected_total_minor,energy_discount_bps,package_discount_bps,offer_expiry_date) values(${b.id}::uuid,${userId}::uuid,${c!.id}::uuid,${promo},${terms.termMonths},${terms.monthlyPriceMinor.toString()}::bigint,${terms.packagePriceMinor?.toString() ?? null}::bigint,${terms.selectedTotalMinor.toString()}::bigint,${terms.energyDiscountBps},${terms.packageDiscountBps},${new Date(terms.nextStageAtMs ?? now + 86400000).toISOString()}::timestamptz)`,
            );
          }
        }
      }
      if (input.action === "month" || input.action === "quarter")
        await issueSeparatedSalesFeeAttempt(tx, userId);
      await refreshSeparatedSalesSelection(tx, userId);
      await cancelSupersededSalesNotices(tx, userId);
      const selected = (
        await tx.execute<{
          total: string;
          term: 1 | 3;
          promo: boolean;
          expiry: string;
        }>(
          sql`select selected_total_minor::text total,term_months term,promo_accepted_flag promo,offer_expiry_date::text expiry from expert_sales_selections where base_id=${b.id}::uuid order by selected_at desc,id desc limit 1`,
        )
      ).rows[0];
      const lock = (
        await tx.execute<{ total: string; term: 1 | 3 }>(
          sql`select final_locked_price::text total,term_months term from expert_sales_paid_locks where user_id=${userId}::uuid`,
        )
      ).rows[0];
      const now = Number(
        (
          await tx.execute<{ ms: string }>(
            sql`select floor(extract(epoch from clock_timestamp())*1000)::text ms`,
          )
        ).rows[0]!.ms,
      );
      const first = Date.parse(b.first),
        standardOnly = now >= first + 240 * 3600000;
      const promotion =
        c?.action === "promo"
          ? true
          : c?.action === "base"
            ? false
            : (selected?.promo ?? null);
      const shown = c
        ? calculateSeparatedSalesTerms({
            baseMonthlyMinor: BigInt(b.amount),
            participantKind: b.kind,
            firstOfferAtMs: first,
            quotedAtMs: now,
            promotion: promotion !== false,
            termMonths: 1,
          })
        : null;
      const invoice = (
        await tx.execute<{ id: string; operation: string; expiry: string }>(
          sql`select i.id,o.id operation,a.expires_at::text expiry from expert_onboarding_invoices i join expert_sales_fee_attempts a on a.invoice_id=i.id join expert_onboarding_payment_operations o on o.invoice_id=i.id where i.user_id=${userId}::uuid and i.status='pending' and a.expires_at>clock_timestamp() and expert_sales_form_valid(i.application_id,i.user_id) order by sales_attempt_number desc limit 1`,
        )
      ).rows[0];
      const deadline =
        invoice?.expiry ??
        (selected && Date.parse(selected.expiry) > now
          ? selected.expiry
          : shown?.nextStageAtMs
            ? new Date(shown.nextStageAtMs).toISOString()
            : null);
      const submitted =
        (
          await tx.execute(
            sql`select 1 from expert_sales_form_bridges where user_id=${userId}::uuid and expert_sales_form_valid(application_id,user_id)`,
          )
        ).rows.length > 0;
      if (input.waveStartAtMs !== undefined) {
        // The phase may have crossed the launch boundary while resolving consent
        // or a replay. Roll back any new choice rather than return stale terms.
        const stillActive = await tx.execute(
          sql`select 1 where early_bird_wave_active(early_bird_current_time())`,
        );
        if (stillActive.rows.length !== 1)
          throw new Error("early_bird_phase_closed");
      }
      return {
        ...(testPrice
          ? {
              waveTestPrice: {
                grantId: testPrice.id,
                onboardingMinor: testPrice.onboarding,
                subscriptionMinor: testPrice.subscription,
              },
            }
          : {}),
        ...(invoice
          ? { invoiceId: invoice.id, operationId: invoice.operation }
          : {}),
        submitted,
        remainingSeconds: deadline
          ? Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000))
          : 0,
        id: b.id,
        revision: c?.revision ?? 0,
        baseMonthlyMinor: b.amount,
        firstOfferAt: new Date(first).toISOString(),
        state: lock
          ? "locked"
          : selected?.term === 3 && now >= first + 168 * 3600000
            ? "period"
            : selected
              ? "form"
              : !c
                ? "base"
                : c.action === "positive"
                  ? "promotion"
                  : "period",
        promotion,
        monthlyPriceMinor: shown?.monthlyPriceMinor.toString() ?? null,
        packagePriceMinor: shown?.packagePriceMinor?.toString() ?? null,
        selectedTotalMinor:
          lock?.total ??
          (selected && shown
            ? ((selected.term === 1
                ? shown.monthlyPriceMinor
                : shown.packagePriceMinor
              )?.toString() ?? null)
            : null),
        termMonths: lock?.term ?? selected?.term ?? null,
        expiresAt: deadline,
        standardOnly,
        replay,
      };
    });
  }
}
export async function createSeparatedSalesQuote(
  tx: Tx,
  userId: string,
  idempotencyKey: string,
  paidOnly = false,
) {
  const source = (
    await tx.execute<{ selectionId: string; lockId: string | null }>(
      sql`select s.id as "selectionId",l.invoice_id as "lockId" from expert_sales_selections s left join expert_sales_paid_locks l on l.selection_id=s.id and l.user_id=s.user_id where s.user_id=${userId}::uuid and (${paidOnly}=false or l.invoice_id is not null) order by l.invoice_id nulls last,s.selected_at desc limit 1`,
    )
  ).rows[0];
  if (!source) return null;
  const prior = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_campaign_quotes where user_id=${userId}::uuid and idempotency_key=${idempotencyKey}`,
    )
  ).rows[0];
  if (prior) return prior.id;
  await tx.execute(
    sql`insert into expert_campaign_anchors(user_id,rule_version,calculation_timestamp) select user_id,policy_version,base_offer_shown_at from expert_sales_bases where user_id=${userId}::uuid on conflict do nothing`,
  );
  return (
    await tx.execute<{
      id: string;
    }>(sql`with instant as materialized (select date_trunc('milliseconds',clock_timestamp()) as quoted_at)
    insert into expert_campaign_quotes(user_id,tariff_version_id,idempotency_key,profile_revision,rule_version,calculation_timestamp,quoted_at,expires_at,term_months,duration_seconds,base_monthly_minor,discounted_monthly_minor,monthly_price_minor,package_price_minor,price_minor,currency,energy_discount_bps,start_discount_bps,floor_applied,display_name,credit_cap_bps,individual_services_enabled,group_event_limit,statistics_level,support_priority,sales_selection_id,paid_lock_invoice_id)
    select b.user_id,b.tariff_version_id,${idempotencyKey},b.profile_revision,b.policy_version,b.base_offer_shown_at,instant.quoted_at,case when ${source.lockId}::uuid is not null then instant.quoted_at+interval '24 hours' else least(s.offer_expiry_date,instant.quoted_at+interval '24 hours') end,s.term_months,2592000*s.term_months,b.base_tariff_amount,div(b.base_tariff_amount::numeric*(10000-s.energy_discount_bps)+5000,10000),s.monthly_price_minor,s.package_price_minor,s.selected_total_minor,'RUB',s.energy_discount_bps,s.package_discount_bps,case when s.term_months=1 then div(b.base_tariff_amount::numeric*(10000-s.energy_discount_bps)+5000,10000)<500000 else div(b.base_tariff_amount::numeric*3*(10000-s.energy_discount_bps)*(10000-s.package_discount_bps)+50000000,100000000)<1500000 end,t.display_name,t.credit_cap_bps,t.individual_services_enabled,t.group_event_limit,t.statistics_level,t.support_priority,s.id,${source.lockId}::uuid from expert_sales_selections s join expert_sales_bases b on b.id=s.base_id join expert_residency_tariff_versions t on t.id=b.tariff_version_id cross join instant where s.id=${source.selectionId}::uuid returning id`)
  ).rows[0]!.id;
}
export async function bridgeSeparatedSalesForm(
  tx: Tx,
  userId: string,
  formId: string,
  revision: number,
) {
  if (
    (
      await tx.execute(
        sql`select 1 from expert_sales_form_bridges where form_id=${formId}::uuid`,
      )
    ).rows.length
  )
    return;
  await refreshSeparatedSalesSelection(tx, userId);
  const selection = (
    await tx.execute<{ id: string }>(
      sql`select id from expert_sales_selections where user_id=${userId}::uuid order by selected_at desc limit 1`,
    )
  ).rows[0];
  if (!selection) return;
  const quoteId = await createSeparatedSalesQuote(
    tx,
    userId,
    `sales-form:${formId}:${revision}`,
  );
  const a = (
    await tx.execute<{ id: string }>(
      sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${userId}::uuid,${quoteId}::uuid) returning id`,
    )
  ).rows[0]!;
  await tx.execute(
    sql`insert into expert_sales_form_bridges(application_id,form_id,user_id,submitted_revision,selection_id,quote_id) values(${a.id}::uuid,${formId}::uuid,${userId}::uuid,${revision},${selection.id}::uuid,${quoteId}::uuid)`,
  );
  await tx.execute(
    sql`insert into expert_promo_manager_work(application_id,user_id) values(${a.id}::uuid,${userId}::uuid)`,
  );
}

/** A changed period reuses the existing quality approval of the same frozen form. */
export async function issueSeparatedSalesFeeAttempt(tx: Tx, userId: string) {
  if (await hasUnresolvedSalesRequest(tx, userId)) return;
  const source = (
    await tx.execute<{
      selectionId: string;
      expiry: string;
      decisionId: string;
      applicationId: string;
      mode: string;
      number: number;
    }>(
      sql`select selected.id as "selectionId",selected.offer_expiry_date::text expiry,d.id as "decisionId",b.application_id as "applicationId",prior.provider_mode mode,prior.sales_attempt_number+1 as number from expert_sales_form_bridges b join residents_applications f on f.id=b.form_id and f.user_id=b.user_id and expert_sales_form_valid(b.application_id,b.user_id) and f.submitted_at is not null join expert_onboarding_applications app on app.id=b.application_id and app.verification_status='approved' join expert_verification_decisions d on d.application_id=app.id and d.decision='approved' join lateral(select s.* from expert_sales_selections s where s.user_id=b.user_id order by selected_at desc,id desc limit 1) selected on true join lateral(select i.* from expert_onboarding_invoices i where i.decision_id=d.id order by sales_attempt_number desc limit 1) prior on true where b.user_id=${userId}::uuid and selected.offer_expiry_date>clock_timestamp() and not exists(select 1 from expert_sales_fee_attempts a where a.selection_id=selected.id) and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id)`,
    )
  ).rows[0];
  if (!source) return;
  const invoice = (
    await tx.execute<{ id: string }>(
      sql`insert into expert_onboarding_invoices(application_id,application_audit_id,user_id,decision_id,provider_mode,sales_attempt_number) values(${source.applicationId}::uuid,${source.applicationId}::uuid,${userId}::uuid,${source.decisionId}::uuid,${source.mode},${source.number}) returning id`,
    )
  ).rows[0]!;
  await tx.execute(
    sql`insert into expert_sales_fee_attempts(invoice_id,user_id,selection_id,expires_at) values(${invoice.id}::uuid,${userId}::uuid,${source.selectionId}::uuid,least(${source.expiry}::timestamptz,clock_timestamp()+interval '24 hours'))`,
  );
  await tx.execute(
    sql`insert into expert_onboarding_payment_operations(invoice_id,application_audit_id,user_id,provider_mode) values(${invoice.id}::uuid,${source.applicationId}::uuid,${userId}::uuid,${source.mode})`,
  );
  await queueSalesNotice(
    tx,
    userId,
    "refresh",
    source.selectionId,
    source.expiry,
    invoice.id,
  );
  return invoice.id;
}

export async function hasUnresolvedSalesRequest(tx: Tx, userId: string) {
  return (
    (
      await tx.execute(
        sql`select 1 from expert_sales_provider_requests r join expert_onboarding_invoices i on i.id=r.invoice_id where i.user_id=${userId}::uuid and r.status='dispatched' limit 1`,
      )
    ).rows.length > 0
  );
}
export async function cancelSupersededSalesNotices(tx: Tx, userId: string) {
  await tx.execute(
    sql`update expert_sales_notices n set status='cancelled',receipt=null from expert_sales_bases b where n.base_id=b.id and b.user_id=${userId}::uuid and n.status in('pending','preparing') and (n.choice_revision is distinct from (select max(revision) from expert_sales_choices where base_id=b.id) or n.selection_id is distinct from (select id from expert_sales_selections where base_id=b.id order by selected_at desc,id desc limit 1))`,
  );
}
export async function queueSalesNotice(
  tx: Tx,
  userId: string,
  kind: "refresh" | "reselect" | "24h" | "3h",
  selectionId: string | null,
  deadline: string,
  invoiceId?: string,
) {
  await cancelSupersededSalesNotices(tx, userId);
  await tx.execute(
    sql`insert into expert_sales_notices(base_id,stage_at,kind,selection_id,invoice_id,choice_revision) select id,${deadline}::timestamptz,${kind},${selectionId}::uuid,${invoiceId ?? null}::uuid,(select max(revision) from expert_sales_choices where base_id=b.id) from expert_sales_bases b where user_id=${userId}::uuid on conflict do nothing`,
  );
}
export async function refreshSeparatedSalesSelection(
  tx: Tx,
  userId: string,
  checkoutExpired = false,
) {
  if (await hasUnresolvedSalesRequest(tx, userId)) return;
  const row = (
    await tx.execute<{
      id: string;
      base: string;
      choice: string;
      promo: boolean;
      term: 1 | 3;
      expiry: string;
      amount: string;
      first: string;
      kind: "expert" | "space";
      now: string;
    }>(
      sql`select s.id,s.base_id base,s.choice_id choice,s.promo_accepted_flag promo,s.term_months term,s.offer_expiry_date::text expiry,b.base_tariff_amount::text amount,b.base_offer_shown_at::text first,b.participant_kind kind,floor(extract(epoch from clock_timestamp())*1000)::text now from expert_sales_bases b join lateral(select s.* from expert_sales_selections s where s.base_id=b.id order by s.selected_at desc,s.id desc limit 1) s on true where b.user_id=${userId}::uuid and b.consent_version is not null and not exists(select 1 from expert_sales_paid_locks where user_id=b.user_id)`,
    )
  ).rows[0];
  if (!row) return;
  checkoutExpired ||=
    (
      await tx.execute(
        sql`select 1 from expert_sales_fee_attempts a join expert_onboarding_invoices i on i.id=a.invoice_id where i.user_id=${userId}::uuid and a.expires_at<=clock_timestamp() and i.sales_attempt_number=(select max(sales_attempt_number) from expert_onboarding_invoices where user_id=i.user_id)`,
      )
    ).rows.length > 0;
  if (!checkoutExpired && Date.parse(row.expiry) > Number(row.now)) return;
  const terms = calculateSeparatedSalesTerms({
    baseMonthlyMinor: BigInt(row.amount),
    participantKind: row.kind,
    firstOfferAtMs: Date.parse(row.first),
    quotedAtMs: Number(row.now),
    promotion: row.promo,
    termMonths: 1,
  });
  if (row.term === 3 && terms.packagePriceMinor === null) {
    await queueSalesNotice(tx, userId, "reselect", row.id, row.expiry);
    return;
  }
  const selection = (
    await tx.execute<{ id: string; expiry: string }>(
      sql`insert into expert_sales_selections(base_id,user_id,choice_id,promo_accepted_flag,term_months,monthly_price_minor,package_price_minor,selected_total_minor,energy_discount_bps,package_discount_bps,offer_expiry_date) values(${row.base}::uuid,${userId}::uuid,${row.choice}::uuid,${row.promo},${row.term},${terms.monthlyPriceMinor.toString()}::bigint,${terms.packagePriceMinor?.toString() ?? null}::bigint,${(row.term === 1 ? terms.monthlyPriceMinor : terms.packagePriceMinor!).toString()}::bigint,${terms.energyDiscountBps},${terms.packageDiscountBps},clock_timestamp()+interval '24 hours') returning id,offer_expiry_date::text expiry`,
    )
  ).rows[0]!;
  const invoice = await issueSeparatedSalesFeeAttempt(tx, userId);
  if (!invoice)
    await queueSalesNotice(
      tx,
      userId,
      "refresh",
      selection.id,
      selection.expiry,
    );
}
