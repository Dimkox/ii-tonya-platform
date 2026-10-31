import { afterAll, beforeAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { startTestPostgres, type TestDatabase } from "../testkit/postgres.js";
import { PostgresYooKassaRefundParentBinding } from "./yookassa-refund-parent-binding.js";
let f: TestDatabase;
beforeAll(async () => {
  f = await startTestPostgres();
  await f.db.execute(
    sql`create table expert_residency_provider_operations(id uuid primary key,order_id uuid not null,provider text not null,operation_kind text not null,provider_object_id text,parent_payment_id text,currency text not null,amount_minor bigint not null)`,
  );
}, 120_000);
afterAll(async () => {
  await f?.stop();
}, 120_000);
it("requires the exact provider payment, refund and order to match", async () => {
  const order = randomUUID(),
    other = randomUUID();
  await f.db.execute(
    sql`insert into expert_residency_provider_operations values(${randomUUID()}::uuid,${order}::uuid,'yookassa','create_payment','p1',null,'RUB',1000),(${randomUUID()}::uuid,${other}::uuid,'yookassa','create_payment','p2',null,'RUB',1000),(${randomUUID()}::uuid,${order}::uuid,'yookassa','create_refund','r1','p1','RUB',100)`,
  );
  const reader = new PostgresYooKassaRefundParentBinding(f.db);
  expect(await reader.matches("r1", "p1")).toBe(true);
  expect(await reader.matches("r1", "p2")).toBe(false);
  expect(await reader.matches("other", "p1")).toBe(false);
  await f.db.execute(
    sql`update expert_residency_provider_operations set order_id=${other}::uuid where provider_object_id='r1'`,
  );
  expect(await reader.matches("r1", "p1")).toBe(false);
}, 120_000);
