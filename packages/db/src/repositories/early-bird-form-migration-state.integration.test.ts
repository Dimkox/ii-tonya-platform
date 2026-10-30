import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../testkit/expert-referral.js";
let db: ExpertReferralTestDatabase;
beforeAll(async () => {
  db = await startExpertReferralTestDatabase();
}, 120_000);
afterAll(async () => {
  await db?.stop();
}, 120_000);
it("replays the wave form migration with ownership, immutability and terminal-review guards", async () => {
  const relations = (
    await db.db.execute<{ name: string }>(
      sql`select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('early_bird_form_enrollments','early_bird_form_bridges') order by c.relname`,
    )
  ).rows.map((x) => x.name);
  expect(relations).toEqual([
    "early_bird_form_bridges",
    "early_bird_form_enrollments",
  ]);
  const triggers = (
    await db.db.execute<{ name: string }>(
      sql`select tgname as name from pg_trigger where not tgisinternal and tgname in ('early_bird_form_enrollment_guard','early_bird_form_bridge_guard','resident_terminal_decision_guard') order by tgname`,
    )
  ).rows.map((x) => x.name);
  expect(triggers).toEqual([
    "early_bird_form_bridge_guard",
    "early_bird_form_enrollment_guard",
    "resident_terminal_decision_guard",
  ]);
  const definitions = (
    await db.db.execute<{ definition: string }>(
      sql`select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resident_terminal_decision_guard'`,
    )
  ).rows;
  expect(definitions).toHaveLength(1);
  expect(definitions[0]!.definition).toContain("early_bird_form_bridges");
  expect(definitions[0]!.definition).toContain("expert_sales_form_bridges");
}, 120_000);
