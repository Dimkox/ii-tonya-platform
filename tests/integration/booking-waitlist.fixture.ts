import { createHash, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { PostgresWaitlistRepository } from "../../packages/db/src/repositories/waitlist-repository.js";
import type { TestDatabase } from "../../packages/db/src/testkit/postgres.js";
import { seedLifecycleFixture } from "./lifecycle-scheduler.fixture.js";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export async function seedWaitlistFixture(database: TestDatabase) {
  const occupied = await seedLifecycleFixture(database);
  const repository = new PostgresWaitlistRepository(database.db);
  async function candidate(label: string) {
    const userId = await database.createUser();
    const choiceDigest = `sha256:${digest(`choice-${label}`)}` as const;
    const requestId = (
      await database.db.execute<{ id: string }>(sql`
        insert into client_catalog_requests(user_id,request_digest,state,expires_at)
        values(${userId}::uuid,${digest(`request-${label}`)},'ready',
          ${new Date(occupied.databaseNow.getTime() + 60 * 60 * 1_000)})
        returning id
      `)
    ).rows[0]!.id;
    await database.db.execute(sql`
      insert into client_catalog_choices(request_id,choice_digest,slot_id,expires_at)
      values(${requestId}::uuid,${choiceDigest},${occupied.slotId}::uuid,
        ${new Date(occupied.databaseNow.getTime() + 60 * 60 * 1_000)})
    `);
    return {
      userId,
      choiceDigest,
      idempotencyKey: digest(`join-${label}`),
      waitlistHandle: `wl1.${Buffer.from(label.padEnd(32, "x"))
        .toString("base64url")
        .slice(0, 43)
        .padEnd(43, "A")}` as const,
      correlationId: randomUUID(),
      holdDurationMs: 259_200_000,
    };
  }
  return { occupied, repository, candidate };
}
