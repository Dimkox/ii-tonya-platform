import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startExpertReferralTestDatabase } from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { saveExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { createSeparatedSalesQuote } from "../../packages/db/src/repositories/expert-separated-sales-repository.js";
it("0060 upgrades actual 0059 submitted plus followup and erased owners without fabricating proof", async () => {
  const root = "packages/db/migrations";
  const journal = JSON.parse(
    readFileSync(`${root}/meta/_journal.json`, "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const fixture = await startExpertReferralTestDatabase(async (db) => {
    for (const entry of journal.entries.filter((e) => e.idx <= 59))
      await db.execute(
        sql.raw(readFileSync(`${root}/${entry.tag}.sql`, "utf8")),
      );
  });
  try {
    const tariff = await fixture.createResidencyTariff({
      tariffKey: "PRO",
      displayName: "PRO",
      priceMinor: 999000,
      durationSeconds: 2592000,
    });
    const owners: string[] = [];
    for (let n = 0; n < 3; n++) {
      const user = await fixture.createUser();
      owners.push(user);
      await seedClientConsent(fixture.db, user, "client_messaging");
      const chat = String(777000 + n);
      const identity = (
        await fixture.db.execute<{ id: string }>(
          sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${user}::uuid,'telegram',${chat},${chat},'upgrade-sales','active') returning id`,
        )
      ).rows[0]!;
      await saveExpertOfferProfile(fixture.db, {
        userId: user,
        cityCode: "kazan",
        millionCity: false,
        serviceFormat: "offline",
        ticketMinor: "300000",
        participantKind: "expert",
        idempotencyKey: randomUUID(),
      });
      const enterSales = async () => {
        const base = (
          await fixture.db.execute<{ id: string }>(
            sql`insert into expert_sales_bases(user_id,tariff_version_id,profile_revision,base_tariff_amount,participant_kind,bot_id,bot_key,chat_id,consent_version) values(${user}::uuid,${tariff}::uuid,1,999000,'expert','717171','upgrade-sales',${chat},'client-messaging-v1') returning id`,
          )
        ).rows[0]!;
        let choice = "";
        for (const [i, action] of ["positive", "promo", "month"].entries())
          choice = (
            await fixture.db.execute<{ id: string }>(
              sql`insert into expert_sales_choices(base_id,user_id,revision,action,request_key,request_digest) values(${base.id}::uuid,${user}::uuid,${i + 1},${action},${randomUUID()},${"a".repeat(64)}) returning id`,
            )
          ).rows[0]!.id;
        return (
          await fixture.db.execute<{ id: string }>(
            sql`insert into expert_sales_selections(base_id,user_id,choice_id,promo_accepted_flag,term_months,monthly_price_minor,package_price_minor,selected_total_minor,energy_discount_bps,package_discount_bps,offer_expiry_date) values(${base.id}::uuid,${user}::uuid,${choice}::uuid,true,1,599400,1528470,599400,4000,1500,clock_timestamp()+interval '24 hours') returning id`,
          )
        ).rows[0]!;
      };
      let selection = n === 2 ? undefined : await enterSales();
      const form = (
        await fixture.db.execute<{ id: string }>(
          sql`insert into residents_applications(user_id,bot_id,bot_key,channel_identity_id,telegram_user_id,chat_id) values(${user}::uuid,'717171','upgrade-sales',${identity.id}::uuid,${chat},${chat}) returning id`,
        )
      ).rows[0]!;
      const draft = {
        roles: ["EXPERT"],
        primaryRole: "EXPERT",
        category: "BASIC",
        tax: "SELF_EMPLOYED",
        city: "Казань",
        socialLinks: ["https://example.com"],
        motivation: "Практика",
        specialization: "Психология",
        averageCheckMinor: "300000",
      };
      await fixture.db.execute(
        sql`update residents_applications set revision=1,draft=${JSON.stringify(draft)}::jsonb,submitted_draft=${JSON.stringify(draft)}::jsonb,submitted_at=clock_timestamp(),status='UNDER_REVIEW',progress='AUTO_CHECK' where id=${form.id}::uuid`,
      );
      const followup = async () => {
        await fixture.db.execute(
          sql`update residents_applications set revision=revision+1 where id=${form.id}::uuid`,
        );
        await fixture.db.execute(
          sql`insert into resident_verification_application_updates(application_id,user_id,revision,kind,answers) values(${form.id}::uuid,${user}::uuid,2,'followup','{"answer":"Дополнение"}')`,
        );
      };
      // Genuine 0059 order: submit, supplement, enter sales, then bridge the current revision.
      if (n === 2) {
        await followup();
        selection = await enterSales();
      }
      await fixture.db.transaction(async (tx) => {
        const quote = await createSeparatedSalesQuote(tx, user, randomUUID());
        const app = (
          await tx.execute<{ id: string }>(
            sql`insert into expert_onboarding_applications(user_id,campaign_quote_id) values(${user}::uuid,${quote}::uuid) returning id`,
          )
        ).rows[0]!;
        await tx.execute(
          sql`insert into expert_sales_form_bridges(application_id,form_id,user_id,submitted_revision,selection_id,quote_id) values(${app.id}::uuid,${form.id}::uuid,${user}::uuid,${n === 2 ? 2 : 1},${selection!.id}::uuid,${quote}::uuid)`,
        );
      });
      if (n === 0) await followup();
      else if (n === 1)
        await fixture.db.execute(
          sql`delete from residents_applications where user_id=${user}::uuid`,
        );
    }
    expect(
      (
        await fixture.db.execute(
          sql`select count(*)::int n from expert_sales_form_bridges`,
        )
      ).rows[0]?.n,
    ).toBe(2);
    expect(
      (
        await fixture.db.execute(
          sql`select b.submitted_revision bridge_revision,w.submitted_revision original_revision from expert_sales_form_bridges b join resident_verification_check_work w on w.application_id=b.form_id and w.user_id=b.user_id where b.user_id=${owners[2]}::uuid`,
        )
      ).rows[0],
    ).toEqual({ bridge_revision: 2, original_revision: 1 });
    await fixture.db.execute(
      sql.raw(
        readFileSync(
          `${root}/0060_separated_sales_review_corrections.sql`,
          "utf8",
        ),
      ),
    );
    const rows = (
      await fixture.db.execute<{
        user: string;
        digest: string | null;
        valid: boolean;
        revision: number;
      }>(
        sql`select user_id as user,submitted_revision revision,submitted_digest digest,expert_sales_form_valid(application_id,user_id) valid from expert_sales_form_bridges`,
      )
    ).rows;
    expect(rows.find((r) => r.user === owners[0])).toMatchObject({
      valid: true,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(rows.find((r) => r.user === owners[2])).toMatchObject({
      valid: true,
      revision: 1,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(rows.find((r) => r.user === owners[1])).toBeUndefined();
    expect(
      (
        await fixture.db.execute(
          sql`select expert_sales_form_valid(gen_random_uuid(),${owners[1]}::uuid) valid`,
        )
      ).rows[0]?.valid,
    ).toBe(false);
    await fixture.db.execute(
      sql`select erase_resident_verification_subject(${owners[0]}::uuid)`,
    );
    await fixture.db.execute(
      sql`select erase_resident_verification_subject(${owners[2]}::uuid)`,
    );
    expect(
      (
        await fixture.db.execute(
          sql`select bool_or(expert_sales_form_valid(application_id,user_id)) valid from expert_sales_form_bridges`,
        )
      ).rows[0]?.valid ?? false,
    ).toBe(false);
  } finally {
    await fixture.stop();
  }
}, 120000);
