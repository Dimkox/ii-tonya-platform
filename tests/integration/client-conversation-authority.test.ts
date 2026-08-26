import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createClientConversationIdentityResolver,
  parseOpaqueConversationToken,
} from "../../packages/application/src/client-conversation-authority.js";
import { PostgresClientConversationPrincipalRepository } from "../../packages/db/src/index.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let testDb: TestDatabase;
beforeAll(async () => {
  testDb = await startTestPostgres();
  await testDb.migrate();
}, 120_000);
beforeEach(async () => testDb.reset());
afterAll(async () => testDb?.stop(), 120_000);

const token = (label: string) =>
  parseOpaqueConversationToken(
    `hmac-sha256:v1:${createHash("sha256").update(label).digest("hex")}`,
  )!;

describe("client conversation identity authority", () => {
  it("freshly resolves only the exact tenant/subject binding for an active user", async () => {
    const userId = await testDb.createUser();
    const tenantToken = token("tenant");
    const subjectToken = token("subject");
    const inserted = await testDb.db.execute<{ bindingId: string }>(sql`
      insert into provider_subject_mappings (
        user_id,provider,tenant_token,subject_token,subject_ciphertext,token_version
      ) values (
        ${userId}::uuid,'selarti.client-thread.v1',${tenantToken},${subjectToken},'ciphertext',1
      ) returning id as "bindingId"
    `);
    const resolver = createClientConversationIdentityResolver(
      new PostgresClientConversationPrincipalRepository(testDb.db),
    );

    await expect(
      resolver.resolveIdentity({ tenantToken, subjectToken }),
    ).resolves.toEqual({
      kind: "resolved",
      identity: { bindingId: inserted.rows[0]!.bindingId, userId },
    });
    await expect(
      resolver.resolveIdentity({
        tenantToken: token("wrong-tenant"),
        subjectToken,
      }),
    ).resolves.toEqual({ kind: "denied" });
    await testDb.db.execute(
      sql`update users set active=false where id=${userId}::uuid`,
    );
    await expect(
      resolver.resolveIdentity({ tenantToken, subjectToken }),
    ).resolves.toEqual({
      kind: "denied",
    });
  });
});
