import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createPrivacyService } from "../../packages/application/src/privacy-service.js";
import { PostgresConsentEvidenceRepository } from "../../packages/db/src/repositories/consent-evidence-repository.js";
import { PostgresPrivacyRepository } from "../../packages/db/src/repositories/privacy-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await startTestPostgres();
  expect((await db.db.execute(sql`show server_version_num`)).rows[0]).toEqual({
    server_version_num: "170005",
  });
  await db.migrate();
}, 180_000);
afterAll(async () => db?.stop(), 60_000);

const repository = () =>
  new PostgresPrivacyRepository(db.db, {
    privacyMutationCapability: { enabled: true },
  });
const evidence = () =>
  new PostgresConsentEvidenceRepository(db.db, {
    consentMutationCapability: { enabled: true },
  });
const service = () =>
  createPrivacyService({
    repository: repository(),
    audit: { append() {} },
    pseudonymize: (id) => id,
  });

it("exports historical decision scope, channel and consumed presentation without credentials after authority changes", async () => {
  const owner = await db.createUser();
  const repo = evidence();
  const document = await repo.approveDocumentVersion({
    documentKey: "consent.client_profile",
    title: "Metadata original",
    body: "Original scope document",
    approvedBy: "synthetic",
  });
  const first = await repo.issuePresentation({
    userId: owner,
    purpose: "client_profile",
    channel: "telegram",
    documentKey: document.documentKey,
  });
  const denied = await repo.recordDecision({
    userId: owner,
    token: first.token,
    purpose: "client_profile",
    policyVersion: first.policyVersion,
    decision: "denied",
    correlationId: "metadata-denied",
    scopeFields: { fields: ["timezone"] },
  });
  const second = await repo.issuePresentation({
    userId: owner,
    purpose: "client_profile",
    channel: "web",
    documentKey: document.documentKey,
  });
  const recipientId = randomUUID();
  const reservationId = randomUUID();
  const granted = await repo.recordDecision({
    userId: owner,
    token: second.token,
    purpose: "client_profile",
    policyVersion: second.policyVersion,
    decision: "granted",
    correlationId: "metadata-granted",
    scopeFields: { fields: ["display_name", "timezone"] },
    recipientId,
    reservationId,
  });
  const before = await repository().exportOwnedSubject(owner);
  await repo.approveDocumentVersion({
    documentKey: document.documentKey,
    title: "Metadata replacement",
    body: "Replacement scope document",
    approvedBy: "synthetic",
  });
  await repository().withdrawConsentAtomically({
    targetUserId: owner,
    purpose: "client_profile",
    policyVersion: "profile-v999",
    correlationId: "metadata-revoked",
  });
  const result = await service().exportSubject({
    principalUserId: owner,
    targetUserId: owner,
    correlationId: "metadata-export",
  });
  expect(result.consents).toHaveLength(3);
  const grant = result.consents.find((c) => c.decision === "granted")!;
  const stored = (
    await db.db.execute<{
      sequence: string;
      createdAt: Date;
      consumedAt: Date;
    }>(
      sql`select c.sequence::text, p.created_at as "createdAt", p.consumed_at as "consumedAt" from consents c join consent_presentations p on p.id=c.presentation_id where c.id=${granted.decisionId}::uuid`,
    )
  ).rows[0]!;
  expect(grant).toEqual(before.consents.find((c) => c.decision === "granted"));
  expect(grant.document).toEqual(document);
  expect(grant.evidence).toEqual({
    decisionId: granted.decisionId,
    sequence: stored.sequence,
    channel: "web",
    scopeFields: { fields: ["display_name", "timezone"] },
    scopeStatus: "complete",
    textSha256: document.textSha256,
    basis: "consent",
    priorDecisionId: denied.decisionId,
    presentation: {
      id: second.presentationId,
      createdAt: new Date(stored.createdAt).toISOString(),
      consumedAt: new Date(stored.consumedAt).toISOString(),
    },
  });
  expect(
    result.consents.find((c) => c.decision === "denied")!.evidence,
  ).toMatchObject({
    channel: "telegram",
    scopeFields: { fields: ["timezone"] },
    scopeStatus: "complete",
    priorDecisionId: null,
  });
  expect(
    result.consents.find((c) => c.decision === "revoked")!.evidence,
  ).toMatchObject({
    channel: null,
    scopeFields: null,
    scopeStatus: "absent",
    textSha256: null,
    basis: "consent",
    presentation: null,
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    first.token,
    second.token,
    `sha256:${createHash("sha256").update(second.token).digest("hex")}`,
    recipientId,
    reservationId,
    "tokenDigest",
    "token_digest",
    "sessionKey",
    "session_key",
    "recipientId",
    "reservationId",
  ])
    expect(serialized).not.toContain(forbidden);
});

it("keeps legacy metadata explicitly null and bigint sequence exact in JSON", async () => {
  const owner = await db.createUser();
  const id = randomUUID();
  await db.db.execute(
    sql`insert into consents(id,user_id,consent_type,decision,policy_version,sequence) overriding system value values (${id}::uuid,${owner}::uuid,'client_profile','denied','legacy','9007199254740993'::bigint)`,
  );
  const result = await repository().exportOwnedSubject(owner);
  expect(JSON.parse(JSON.stringify(result)).consents[0]).toMatchObject({
    document: null,
    evidence: {
      decisionId: id,
      sequence: "9007199254740993",
      channel: null,
      scopeFields: null,
      scopeStatus: "absent",
      textSha256: null,
      basis: null,
      priorDecisionId: null,
      presentation: null,
    },
  });
});

it.each(["owner", "purpose", "document", "session", "missing"] as const)(
  "rejects a presentation with mismatched %s and hides a foreign prior decision",
  async (mismatch) => {
    const owner = await db.createUser();
    const other = await db.createUser();
    const repo = evidence();
    const document = await repo.approveDocumentVersion({
      documentKey: "consent.client_profile",
      title: "Binding fixture",
      body: `Binding ${mismatch}`,
      approvedBy: "synthetic",
    });
    const foreignId = randomUUID();
    await db.db.execute(
      sql`insert into consents(id,user_id,consent_type,decision,policy_version,scope_fields) values (${foreignId}::uuid,${other}::uuid,'client_profile','denied','foreign-policy','{"private":"foreign-metadata"}'::jsonb)`,
    );
    const presentation = await repo.issuePresentation({
      userId: mismatch === "owner" ? other : owner,
      purpose: "client_profile",
      channel: "web",
      documentKey: document.documentKey,
    });
    if (mismatch === "purpose")
      await db.db.execute(
        sql`update consent_presentations set purpose='follow_up' where id=${presentation.presentationId}::uuid`,
      );
    if (mismatch === "session")
      await db.db.execute(
        sql`update consent_presentations set user_id=null, session_key='synthetic-private-session' where id=${presentation.presentationId}::uuid`,
      );
    const decisionDocument =
      mismatch === "document"
        ? await repo.approveDocumentVersion({
            documentKey: document.documentKey,
            title: "Other binding",
            body: "Other binding body",
            approvedBy: "synthetic",
          })
        : document;
    await db.db.execute(
      sql`insert into consents(user_id,consent_type,decision,policy_version,document_version_id,presentation_id,prior_decision_id) values (${owner}::uuid,'client_profile','denied','binding-fixture',${decisionDocument.id}::uuid,${mismatch === "missing" ? null : presentation.presentationId}::uuid,${foreignId}::uuid)`,
    );
    const result = await repository().exportOwnedSubject(owner);
    expect(result.consents).toHaveLength(1);
    expect(result.consents[0]!.evidence).toMatchObject({
      presentation: null,
      priorDecisionId: null,
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      other,
      foreignId,
      presentation.presentationId,
      presentation.token,
      "foreign-policy",
      "foreign-metadata",
      "synthetic-private-session",
    ])
      expect(serialized).not.toContain(forbidden);
    await expect(
      service().exportSubject({
        principalUserId: other,
        targetUserId: owner,
        correlationId: "foreign-export",
      }),
    ).rejects.toThrow("Cross-subject privacy access denied");
  },
);

it("preserves decision metadata independently of presentation metadata, with null consumption and a dangling prior link", async () => {
  const owner = await db.createUser();
  const repo = evidence();
  const document = await repo.approveDocumentVersion({
    documentKey: "consent.follow_up",
    title: "Nullable binding",
    body: "Nullable evidence",
    approvedBy: "synthetic",
  });
  const presentation = await repo.issuePresentation({
    userId: owner,
    purpose: "follow_up",
    channel: "web",
    documentKey: document.documentKey,
  });
  await db.db.execute(
    sql`insert into consents(user_id,consent_type,decision,policy_version,document_version_id,presentation_id,prior_decision_id,channel,text_sha256) values (${owner}::uuid,'follow_up','denied','nullable',${document.id}::uuid,${presentation.presentationId}::uuid,${randomUUID()}::uuid,'telegram',${"a".repeat(64)})`,
  );
  const result = await repository().exportOwnedSubject(owner);
  expect(result.consents[0]!.evidence).toMatchObject({
    priorDecisionId: null,
    channel: "telegram",
    scopeFields: null,
    scopeStatus: "absent",
    textSha256: "a".repeat(64),
    basis: null,
    presentation: { id: presentation.presentationId, consumedAt: null },
  });
});

it("exports only approved scope shapes, marks redaction and preserves stored originals", async () => {
  const owner = await db.createUser();
  const hiddenRecipient = randomUUID();
  const cases = [
    { value: null, status: "absent", exported: null },
    { value: {}, status: "complete", exported: {} },
    { value: { fields: [] }, status: "complete", exported: { fields: [] } },
    {
      value: { fields: ["timezone", "display_name"] },
      status: "complete",
      exported: { fields: ["timezone", "display_name"] },
    },
    {
      value: {
        fields: ["timezone"],
        nested: {
          sessionKey: "synthetic-scope-session",
          tokenDigest: "synthetic-scope-digest",
          recipientId: hiddenRecipient,
          reservationId: "synthetic-scope-reservation",
          providerCredentials: "synthetic-scope-credentials",
        },
      },
      status: "redacted",
      exported: null,
    },
    {
      value: { fields: ["timezone", "timezone"] },
      status: "redacted",
      exported: null,
    },
    { value: { fields: ["expert_note"] }, status: "redacted", exported: null },
    { value: "synthetic-scope-secret", status: "redacted", exported: null },
    { value: ["timezone"], status: "redacted", exported: null },
    {
      value: { fields: [{ token: "synthetic-nested-token" }] },
      status: "redacted",
      exported: null,
    },
  ];
  const ids: string[] = [];
  for (const entry of cases) {
    const id = randomUUID();
    ids.push(id);
    await db.db.execute(
      sql`insert into consents(id,user_id,consent_type,decision,policy_version,scope_fields) values (${id}::uuid,${owner}::uuid,'client_profile','denied','scope-fixture',${JSON.stringify(entry.value)}::jsonb)`,
    );
  }
  const result = await service().exportSubject({
    principalUserId: owner,
    targetUserId: owner,
    correlationId: "scope-export",
  });
  expect(result.consents).toHaveLength(cases.length);
  for (const [index, entry] of cases.entries()) {
    expect(
      result.consents.find((c) => c.evidence.decisionId === ids[index])!
        .evidence,
    ).toMatchObject({ scopeFields: entry.exported, scopeStatus: entry.status });
    const stored = (
      await db.db.execute<{ scope: unknown }>(
        sql`select scope_fields as scope from consents where id=${ids[index]}::uuid`,
      )
    ).rows[0]!;
    expect(stored.scope).toEqual(entry.value);
  }
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    hiddenRecipient,
    "synthetic-scope-",
    "synthetic-nested-token",
    "sessionKey",
    "tokenDigest",
    "recipientId",
    "reservationId",
    "providerCredentials",
    "expert_note",
  ])
    expect(serialized).not.toContain(forbidden);
});
