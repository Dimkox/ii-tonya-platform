import { sql } from "drizzle-orm";

import type { DrizzleDb } from "../client.js";

export type ClientConversationLifecycleTransaction = Parameters<
  DrizzleDb["transaction"]
>[0] extends (transaction: infer T) => unknown
  ? T
  : never;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function lockClientConversationLifecycle(
  tx: ClientConversationLifecycleTransaction,
  userId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(userId)) return false;
  const user = (
    await tx.execute<{ userId: string }>(sql`
      select id as "userId" from users
      where id=${userId}::uuid
      for update
    `)
  ).rows[0];
  if (user === undefined) return false;
  await tx.execute(sql`
    select id from provider_subject_mappings
    where user_id=${userId}::uuid
    order by id
    for update
  `);
  await tx.execute(sql`
    select g.id from client_conversation_grants g
    join provider_subject_mappings m
      on m.id=g.provider_subject_mapping_id
    where m.user_id=${userId}::uuid
    order by g.id
    for update of g
  `);
  await tx.execute(sql`
    select o.id from client_conversation_operations o
    join provider_subject_mappings m on m.id=o.binding_id
    where m.user_id=${userId}::uuid
    order by o.id
    for update of o
  `);
  return true;
}
