import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createEarlyBirdOwnerJourney } from "../testkit/early-bird-owner-journey.js";
import { publicTestDigest } from "../testkit/public-expert-payment.js";
import {
  publicFinancialCall,
  publicFinancialClock,
  approvePublicWaveFinancialCard,
  publicFinancialPrepared,
  publicFinancialTerminal,
  type publicFinancialOwner,
} from "../testkit/public-expert-payment-financial.js";
import { PostgresExpertResidencyProviderInboxRepository } from "./expert-residency-provider-inbox-repository.js";
let wave: Awaited<ReturnType<typeof createEarlyBirdOwnerJourney>>;
let card: Awaited<ReturnType<typeof approvePublicWaveFinancialCard>>;
let account: string;
const q = (text: string, values: unknown[] = []) =>
  wave.db.db.$client.query(text, values);
const call = (name: string, args: unknown[]) =>
  publicFinancialCall(wave.db, name, args);
beforeAll(async () => {
  wave = await createEarlyBirdOwnerJourney();
  await wave.db.enableExpertReferralCommands();
  await q(
    "update early_bird_composite_intents set status='abandoned' where id=$1",
    [wave.identity.operationId],
  );
  const choice = (
    await q(
      "insert into early_bird_choices(user_id,base_id,positive_choice_id,revision,choice,request_key,request_digest) select user_id,base_id,positive_choice_id,revision,'later',$2,$3 from early_bird_choices where id=$1 returning id",
      [
        wave.choice,
        randomUUID(),
        publicTestDigest("wave-b-financial").slice(7),
      ],
    )
  ).rows[0]!.id;
  const config = (
    await q("select config_id from early_bird_composite_intents where id=$1", [
      wave.identity.operationId,
    ])
  ).rows[0]!.config_id;
  account = randomUUID();
  await call("public.early_bird_deferred_prepare", [
    account,
    wave.user,
    wave.base,
    choice,
    config,
  ]);
  const invoice = randomUUID(),
    provider = `wave_b_${randomUUID()}`,
    digest = publicTestDigest(randomUUID());
  await call("public.early_bird_deferred_invoice", [
    account,
    wave.user,
    invoice,
    randomUUID(),
    "onboarding",
  ]);
  await call("public.early_bird_deferred_bind_verified", [
    invoice,
    wave.user,
    provider,
    1000,
    digest,
  ]);
  await call("public.early_bird_deferred_commit_verified", [
    invoice,
    wave.user,
    provider,
    1000,
    digest,
    new Date().toISOString(),
  ]);
  card = await approvePublicWaveFinancialCard(wave.db, wave.user);
  await publicFinancialClock(wave.db, "2027-01-11T20:00:00Z");
  await q(
    "insert into early_bird_wave_one_exclusions(user_id,account_id) values($1,$2)",
    [wave.user, account],
  );
}, 120000);
afterAll(async () => wave?.db.stop(), 120000);
it("preserves genuine deferred paid onboarding after wave exclusion and accepts a fresh public main purchase without reapproval", async () => {
  expect(
    await call("public.early_bird_paid_workspace", [wave.user]),
  ).toBeNull();
  expect(await call("public_wave_application", [wave.user])).toBe(
    card.applicationId,
  );
  const before = (
    await q(
      "select approved_review_id,revision from expert_card_drafts where user_id=$1",
      [wave.user],
    )
  ).rows[0];
  const f = await publicFinancialPrepared(
    wave.db,
    card as Awaited<ReturnType<typeof publicFinancialOwner>>,
  );
  const t = await publicFinancialTerminal(wave.db, f);
  const repo = new PostgresExpertResidencyProviderInboxRepository(wave.db.db);
  expect(
    await repo.applyPublic(
      f.d.requestId,
      t.observationId,
      t.action.applyAttemptId,
    ),
  ).toMatchObject({
    kind: "settled",
    residencyStartsAt: "2027-01-11T21:00:00.123456Z",
  });
  expect(
    await call("public_payment_complete", [
      f.d.requestId,
      t.action.applyAttemptId,
    ]),
  ).toMatchObject({ kind: "already_applied" });
  expect(
    (
      await q(
        "select approved_review_id,revision from expert_card_drafts where user_id=$1",
        [wave.user],
      )
    ).rows[0],
  ).toEqual(before);
  expect(
    (
      await q(
        "select count(*)::int n from expert_onboarding_invoices where user_id=$1",
        [wave.user],
      )
    ).rows[0]!.n,
  ).toBe(0);
  expect(
    (
      await q(
        "select count(*)::int n from early_bird_wave_one_exclusions where user_id=$1",
        [wave.user],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it("archive still revokes public continuation despite retained paid onboarding and exclusion", async () => {
  await q(
    "update expert_onboarding_applications set archived_at=clock_timestamp(),archive_until_date=clock_timestamp()+interval '1 day' where id=$1",
    [card.applicationId],
  );
  expect(await call("public_wave_application", [wave.user])).toBeNull();
});

it("keeps verified public capture immutable when a later direct update tries to alter settled_at alone", async () => {
  const order = (
    await q(
      "select o.id from expert_residency_orders o join experts e on e.id=o.expert_id where e.user_id=$1 and o.status='settled'",
      [wave.user],
    )
  ).rows[0]!.id;
  await expect(
    q(
      "update expert_residency_orders set settled_at=settled_at-interval '1 microsecond' where id=$1",
      [order],
    ),
  ).rejects.toThrow("public_financial_apply_context_required");
});
