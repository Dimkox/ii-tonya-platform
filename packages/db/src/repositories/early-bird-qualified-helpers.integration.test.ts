import { applyEarlyBirdDraftIfNeeded } from "../testkit/early-bird-draft-helper.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
import { seedClientConsent } from "../testkit/client-consent.js";
let fixture: ExpertReferralTestDatabase;
beforeAll(async () => {
  fixture = await startExpertReferralTestDatabase(undefined, {
    forceDisposableCluster: true,
  });
  await fixture.db.execute(
    sql`create table early_bird_composite_intents(id uuid primary key, user_id uuid not null, choice_id uuid, unique(id,user_id))`,
  );
  await fixture.db.execute(
    sql`create table early_bird_verified_bindings(intent_id uuid primary key, user_id uuid not null, provider_object_id text not null)`,
  );
  await applyEarlyBirdDraftIfNeeded(
    fixture.db,
    "docs/superpowers/implementation-artifacts/drafts/0082_early_bird_settlement.sql",
  );
  await applyEarlyBirdDraftIfNeeded(
    fixture.db,
    "docs/superpowers/implementation-artifacts/drafts/wave_admission_projection.sql",
  );
}, 120_000);
afterAll(async () => {
  await fixture?.stop();
}, 120_000);
it("preserves legacy consent and safety helpers under the restricted search path", async () => {
  const user = await fixture.createUser();
  await seedClientConsent(fixture.db, user, "client_messaging");
  const baseline = await fixture.db.execute(
    sql`select expert_card_current_messaging_authority(${user}::uuid,'client-messaging-v1') as allowed, resident_safety_compile('пример') as compiled`,
  );
  const restricted = await fixture.db.transaction(async (tx) => {
    await tx.execute(sql`set local search_path=pg_catalog`);
    return tx.execute(
      sql`select public.expert_card_current_messaging_authority(${user}::uuid,'client-messaging-v1') as allowed, public.resident_safety_compile('пример') as compiled`,
    );
  });
  expect(baseline.rows[0]).toEqual(restricted.rows[0]);
  expect(restricted.rows[0]?.allowed).toBe(true);
  await fixture.db.execute(
    sql`create role wave_helper_reader login password 'synthetic-only' noinherit nosuperuser nocreatedb nocreaterole nobypassrls`,
  );
  await fixture.db.execute(
    sql`grant select on consent_states, consents, consent_document_versions, consent_presentations to wave_helper_reader`,
  );
  const address = new URL(fixture.db.$client.options.connectionString!);
  address.username = "wave_helper_reader";
  address.password = "synthetic-only";
  const pool = new Pool({ connectionString: address.toString(), max: 1 });
  try {
    await pool.query("set search_path=pg_catalog");
    const limited = await pool.query(
      "select public.expert_card_current_messaging_authority($1::uuid,'client-messaging-v1') as allowed, public.resident_safety_compile('пример') as compiled",
      [user],
    );
    expect(limited.rows[0]).toEqual(baseline.rows[0]);
  } finally {
    await pool.end();
  }
}, 120_000);
