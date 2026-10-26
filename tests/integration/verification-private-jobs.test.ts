import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
import { PostgresResidentPrivateJobsRepository } from "../../packages/db/src/repositories/resident-private-jobs-repository.js";
let database: ExpertReferralTestDatabase;
let privateTariff: string | undefined;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
async function applicant() {
  const userId = await database.createUser(),
    chat = String(Math.floor(Math.random() * 1e12) + 1);
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${userId}::uuid,'telegram',${chat},${chat},'resident-private','active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  const scope = {
    botId: "717171",
    botKey: "resident-private",
    telegramUserId: chat,
    chatId: chat,
  };
  const form = await new PostgresResidentVerificationRepository(database.db, {
    botId: scope.botId,
    botKey: scope.botKey,
    messagingConsentPolicyVersion: "client-messaging-v1",
  }).mutate({
    ...scope,
    action: "start",
    requestKey: randomUUID(),
    requestDigest: "a".repeat(64),
  });
  return { userId, scope, form };
}
const policy = { messagingConsentPolicyVersion: "client-messaging-v1" };
const reference = {
  kind: "document" as const,
  fileId: "private_source_file",
  mimeType: "application/pdf",
  size: 32,
};
describe("private custody PostgreSQL fences", () => {
  it("allocates immutable random key before upload, single claim and foreign-owner denial", async () => {
    const a = await applicant(),
      b = await applicant(),
      r = new PostgresResidentPrivateJobsRepository(database.db, policy);
    const c = await r.addBrief(a.scope, a.form.id, 0, reference);
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/u);
    await expect(r.addBrief(b.scope, a.form.id, 0, reference)).rejects.toThrow(
      "private_source_unavailable",
    );
    const claimed = await Promise.all([
      r.claimDocument(c.id),
      r.claimDocument(c.id),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    const durable = (
      await database.db.execute(
        sql`select object_key,write_state from resident_object_deletions where custody_id=${c.id}::uuid`,
      )
    ).rows[0];
    expect(durable).toMatchObject({
      object_key: `custody/${c.id}`,
      write_state: "inflight",
    });
  });
  it("erasure keeps unknown responsibility after late PUT and cannot recreate applicant payload", async () => {
    const a = await applicant(),
      r = new PostgresResidentPrivateJobsRepository(database.db, policy),
      c = await r.addBrief(a.scope, a.form.id, 0, reference),
      claim = (await r.claimDocument(c.id))!;
    await database.db.execute(
      sql`delete from residents_applications where id=${a.form.id}::uuid`,
    );
    await r.completeDocument(claim, {
      kind: "unknown",
      sha256: "a".repeat(64),
    });
    expect(
      (
        await database.db.execute(
          sql`select * from resident_private_objects where id=${c.id}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.db.execute(
          sql`select erased,write_state,delete_state from resident_object_deletions where custody_id=${c.id}::uuid`,
        )
      ).rows[0],
    ).toMatchObject({
      erased: true,
      write_state: "unknown",
      delete_state: "pending",
    });
    await r.recordDeletion(
      c.id,
      "absent",
      (await r.claimDeletion(c.id))!.token,
    );
    expect(
      (
        await database.db.execute(
          sql`select delete_state from resident_object_deletions where custody_id=${c.id}::uuid`,
        )
      ).rows[0]?.delete_state,
    ).toBe("unknown");
  });
  it("settled upload erased later can be deleted conclusively; no private payload in tombstone", async () => {
    const a = await applicant(),
      r = new PostgresResidentPrivateJobsRepository(database.db, policy),
      c = await r.addBrief(a.scope, a.form.id, 0, reference),
      claim = (await r.claimDocument(c.id))!;
    await r.completeDocument(claim, {
      kind: "verified",
      sha256: "b".repeat(64),
      proposal: { city: "Казань" },
    });
    await database.db.execute(
      sql`delete from residents_applications where id=${a.form.id}::uuid`,
    );
    await r.recordDeletion(
      c.id,
      "absent",
      (await r.claimDeletion(c.id))!.token,
    );
    const row = (
      await database.db.execute(
        sql`select * from resident_object_deletions where custody_id=${c.id}::uuid`,
      )
    ).rows[0]!;
    expect(row.delete_state).toBe("verified");
    expect(JSON.stringify(row)).not.toContain("Казань");
    expect(JSON.stringify(row)).not.toContain(reference.fileId);
  });
  it("only explicit owner confirmation applies still-empty proposal at exact revision", async () => {
    const a = await applicant(),
      r = new PostgresResidentPrivateJobsRepository(database.db, policy),
      c = await r.addBrief(a.scope, a.form.id, 0, reference),
      claim = (await r.claimDocument(c.id))!;
    await r.completeDocument(claim, {
      kind: "verified",
      sha256: "c".repeat(64),
      proposal: { city: "Казань" },
    });
    expect(
      (
        await database.db.execute(
          sql`select draft from residents_applications where id=${a.form.id}::uuid`,
        )
      ).rows[0]?.draft,
    ).toEqual({});
    await r.confirmBrief(a.scope, a.form.id, c.id, 0);
    expect(
      (
        await database.db.execute(
          sql`select draft from residents_applications where id=${a.form.id}::uuid`,
        )
      ).rows[0]?.draft,
    ).toEqual({ city: "Казань" });
    await expect(r.confirmBrief(a.scope, a.form.id, c.id, 0)).rejects.toThrow(
      "private_proposal_stale",
    );
  });
  it("stale completion does not mutate form; forbidden extracted financial fields fail", async () => {
    const a = await applicant(),
      r = new PostgresResidentPrivateJobsRepository(database.db, policy),
      c = await r.addBrief(a.scope, a.form.id, 0, reference),
      claim = (await r.claimDocument(c.id))!;
    await expect(
      r.completeDocument(claim, {
        kind: "verified",
        sha256: "d".repeat(64),
        proposal: { final_locked_price: "1" } as never,
      }),
    ).rejects.toThrow("private_proposal_invalid");
    await database.db.execute(
      sql`update residents_applications set draft='{"city":"Москва"}'::jsonb,revision=revision+1 where id=${a.form.id}::uuid`,
    );
    await r.completeDocument(claim, {
      kind: "verified",
      sha256: "d".repeat(64),
      proposal: { city: "Казань" },
    });
    await expect(r.confirmBrief(a.scope, a.form.id, c.id, 1)).rejects.toThrow(
      "private_proposal_stale",
    );
    expect(
      (
        await database.db.execute(
          sql`select draft from residents_applications where id=${a.form.id}::uuid`,
        )
      ).rows[0]?.draft,
    ).toEqual({ city: "Москва" });
  });
});

async function submitForJobs(
  a: Awaited<ReturnType<typeof applicant>>,
  extra: Record<string, unknown> = {},
) {
  const { saveExpertOfferProfile } =
    await import("../../packages/db/src/repositories/expert-offer-v2.js");
  const { PostgresExpertSeparatedSalesRepository } =
    await import("../../packages/db/src/repositories/expert-separated-sales-repository.js");
  await saveExpertOfferProfile(database.db, {
    userId: a.userId,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  const tariff = (privateTariff ??= await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  }));
  const sales = new PostgresExpertSeparatedSalesRepository(database.db, {
    ...a.scope,
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  const command = () => ({
    ...a.scope,
    requestKey: randomUUID(),
    requestDigest: "f".repeat(64),
  });
  let sale = await sales.transition({ ...command(), tariffVersionId: tariff });
  for (const action of ["positive", "promo", "month"] as const)
    sale = await sales.transition({
      ...command(),
      baseId: sale!.id,
      revision: sale!.revision,
      action,
    });
  const repo = new PostgresResidentVerificationRepository(database.db, {
    ...a.scope,
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  await repo.mutate({
    ...command(),
    action: "patch",
    expectedRevision: 0,
    patch: {
      roles: ["OTHER"],
      primaryRole: "OTHER",
      category: "BASIC",
      tax: "INDIVIDUAL_NO_STATUS",
      city: "Онлайн",
      socialLinks: ["https://vk.com/id123"],
      motivation: "Практика",
      path: "Путь",
      cases: "Описание",
      ...extra,
    },
  });
  const form = await repo.mutate({
    ...command(),
    action: "submit",
    expectedRevision: 1,
  });
  const applicationId = (
    await database.db.execute<{ id: string }>(
      sql`select application_id id from expert_sales_form_bridges where form_id=${form.id}::uuid`,
    )
  ).rows[0]!.id;
  return { form, applicationId };
}
it("stale prefix cannot starve the next eligible document", async () => {
  const r = new PostgresResidentPrivateJobsRepository(database.db, policy);
  // Retire any earlier test's pending documents first; this witness owns its six rows.
  for (const row of await r.listDocuments(10)) await r.claimDocument(row.id);
  for (let i = 0; i < 5; i++) {
    const a = await applicant();
    await r.addBrief(a.scope, a.form.id, 0, reference);
    await database.db.execute(
      sql`update residents_applications set draft='{"city":"Москва"}'::jsonb,revision=revision+1 where id=${a.form.id}::uuid`,
    );
  }
  const a = await applicant(),
    last = await r.addBrief(a.scope, a.form.id, 0, reference);
  const prefix = await r.listDocuments();
  expect(prefix).toHaveLength(5);
  for (const row of prefix) expect(await r.claimDocument(row.id)).toBeNull();
  expect((await r.listDocuments()).some((x) => x.id === last.id)).toBe(true);
  expect(await r.claimDocument(last.id)).not.toBeNull();
});
it("current evidence claims are unique, cache expires exactly at 24h and stale generations cannot overwrite", async () => {
  const a = await applicant(),
    r = new PostgresResidentPrivateJobsRepository(database.db, policy);
  await submitForJobs(a);
  await r.listEvidenceJobs();
  const claims = await Promise.all([
    r.claimEvidence(a.form.id, 1),
    r.claimEvidence(a.form.id, 1),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claim = claims.find(Boolean)!;
  const now = new Date();
  const observation = {
    profile: "https://vk.com/id123",
    adapterVersion: "vk-wall-v1",
    observedAt: now.toISOString(),
    expiresAt: new Date(+now + 86400000).toISOString(),
    source: "vk_api",
    coverage: "complete_latest",
    reason: null,
    posts: [],
    activity: "UNKNOWN",
    score: null,
    scorePolicy: "not_configured",
  };
  expect(await r.completeEvidence(claim, [observation])).toBe(true);
  expect(
    await r.completeEvidence(claim, [{ ...observation, activity: "INACTIVE" }]),
  ).toBe(false);
  expect(
    await r.cachedSocial(
      a.form.id,
      observation.profile,
      observation.adapterVersion,
    ),
  ).toEqual(observation);
  await database.db.execute(
    sql`with t as materialized(select clock_timestamp()-interval '1 second' n) update resident_social_observations set observed_at=t.n-interval '24 hours',expires_at=t.n from t where user_id=${a.userId}::uuid`,
  );
  expect(
    await r.cachedSocial(
      a.form.id,
      observation.profile,
      observation.adapterVersion,
    ),
  ).toBeUndefined();
  const expired = {
    ...observation,
    observedAt: new Date(+now - 86400000).toISOString(),
    expiresAt: now.toISOString(),
  };
  await database.db.execute(
    sql`update resident_evidence_jobs set result=${JSON.stringify({ social: [expired] })}::jsonb where application_id=${a.form.id}::uuid and generation=1`,
  );
  expect(
    (await r.listEvidenceJobs()).some((x) => x.applicationId === a.form.id),
  ).toBe(true);
  const refresh = await r.claimEvidence(a.form.id, 1);
  expect(refresh).not.toBeNull();
  expect(refresh!.claimToken).not.toBe(claim.claimToken);
  expect(await r.completeEvidence(claim, [observation])).toBe(false);

  const other = await applicant();
  expect(
    await r.cachedSocial(
      other.form.id,
      observation.profile,
      observation.adapterVersion,
    ),
  ).toBeUndefined();
});
it("late evidence completion after subject deletion cannot resurrect results or cache", async () => {
  const a = await applicant(),
    r = new PostgresResidentPrivateJobsRepository(database.db, policy);
  await submitForJobs(a);
  await r.listEvidenceJobs();
  const claim = (await r.claimEvidence(a.form.id, 1))!;
  await database.db.execute(
    sql`delete from residents_applications where id=${a.form.id}::uuid`,
  );
  expect(await r.completeEvidence(claim, [])).toBe(false);
  expect(
    (
      await database.db.execute(
        sql`select 1 from resident_evidence_jobs where application_id=${a.form.id}::uuid`,
      )
    ).rows,
  ).toHaveLength(0);
});
it("actual owner service requires a dedicated brief command and explicit exact-revision confirmation", async () => {
  const { createResidentVerificationService } =
    await import("../../packages/application/src/resident-verification-service.js");
  const a = await applicant(),
    r = new PostgresResidentPrivateJobsRepository(database.db, policy);
  const repository = new PostgresResidentVerificationRepository(database.db, {
    ...a.scope,
    messagingConsentPolicyVersion: policy.messagingConsentPolicyVersion,
  });
  const service = createResidentVerificationService({
    enabled: true,
    repository,
    privateDocuments: r,
  });
  const accepted = await service.handle({
    ...a.scope,
    updateId: 1,
    text: "/brief",
    media: reference,
  });
  expect(accepted).toMatchObject({ status: "handled" });
  const c = (await r.briefStatus(a.scope, a.form.id))[0]!,
    claim = (await r.claimDocument(String(c.id)))!;
  await r.completeDocument(claim, {
    kind: "verified",
    sha256: "e".repeat(64),
    proposal: { city: "Казань" },
  });
  expect(
    await service.handle({ ...a.scope, updateId: 2, text: "/brief_status" }),
  ).toMatchObject({
    status: "handled",
    text: expect.stringContaining("/brief_confirm"),
  });
  expect(
    (
      await database.db.execute(
        sql`select draft from residents_applications where id=${a.form.id}::uuid`,
      )
    ).rows[0]?.draft,
  ).toEqual({});
  expect(
    await service.handle({
      ...a.scope,
      updateId: 3,
      text: `/brief_confirm ${String(c.id)} 0`,
    }),
  ).toMatchObject({
    status: "handled",
    text: expect.stringContaining("сохранены"),
  });
});
it("actual protected manager routes issue only an exact signed link and recheck MFA/consent", async () => {
  const { createHash } = await import("node:crypto");
  const Fastify = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )(
    "fastify",
  ) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
  const { expertVerificationRoutes } =
    await import("../../apps/api/src/routes/expert-verification.js");
  const { createExpertVerificationService } =
    await import("../../packages/application/src/expert-verification-service.js");
  const { PostgresExpertVerificationRepository } =
    await import("../../packages/db/src/repositories/expert-verification-repository.js");
  const { createPrivateObjectStore } =
    await import("../../packages/integrations/src/documents/private-verification.js");
  const a = await applicant(),
    r = new PostgresResidentPrivateJobsRepository(database.db, policy),
    c = await r.addBrief(a.scope, a.form.id, 0, reference),
    claim = (await r.claimDocument(c.id))!;
  await r.completeDocument(claim, { kind: "verified", sha256: "f".repeat(64) });
  const submitted = await submitForJobs(a);
  const token = "private-manager-" + randomUUID(),
    session = "sha256:" + createHash("sha256").update(token).digest("hex"),
    manager = await database.createUser();
  await database.db.execute(
    sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
  );
  await database.db.execute(
    sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
  );
  const store = createPrivateObjectStore({
    bucket: "private-fixture",
    region: "test-1",
    endpoint: "https://private-storage.example.test",
    credentials: {
      accessKeyId: "local-access",
      secretAccessKey: "local-secret",
    },
    dedicatedNonVersionedVerified: true,
  });
  let presigns = 0;
  const service = createExpertVerificationService({
    enabled: true,
    repository: new PostgresExpertVerificationRepository(database.db, {
      providerMode: "test",
      ...policy,
    }),
    privateEvidence: {
      async detail(s, id) {
        return {
          documents: await r.managerObjects(s, id),
          evidence: await r.managerEvidence(s, id),
        };
      },
      link: (s, id, doc) =>
        r.managerLink(s, id, doc, (p) => {
          presigns++;
          return store.presign(p);
        }),
      recoveryList: (s) => r.recoveryList(s),
      requestRecovery: (s, id) => r.requestRecovery(s, id),
    },
  });
  const app = Fastify();
  await app.register(expertVerificationRoutes, { enabled: true, service });
  const headers = { authorization: "Bearer " + token },
    path = `/v1/admin/expert-verification/${submitted.applicationId}`;
  try {
    expect(
      (
        await app.inject({
          method: "GET",
          url: path + "/private-evidence",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(presigns).toBe(0);
    const link = await app.inject({
      method: "POST",
      url: path + `/documents/${c.id}/link`,
      headers,
    });
    expect(link.statusCode).toBe(200);
    expect(new URL(link.json().item.url).pathname).toBe(
      "/private-fixture/custody/" + c.id,
    );
    expect(link.json().item.expiresIn).toBe(120);
    expect(
      (
        await app.inject({
          method: "POST",
          url: path + `/documents/${c.id}/link`,
          headers,
          payload: { key: "another" },
        })
      ).statusCode,
    ).toBe(400);
    const audit = (
      await database.db.execute(
        sql`select * from resident_document_access_audit where custody_id=${c.id}::uuid`,
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("X-Amz");
    await database.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp()-interval '16 minutes' where session_id_hash=${session}`,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: path + `/documents/${c.id}/link`,
          headers,
        })
      ).statusCode,
    ).toBe(403);
    await database.db.execute(
      sql`update admin_sessions set mfa_verified_at=clock_timestamp() where session_id_hash=${session}`,
    );
    await database.db.execute(
      sql`delete from residents_applications where id=${a.form.id}::uuid`,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: path + `/documents/${c.id}/link`,
          headers,
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/admin/expert-verification/private-recovery",
          headers,
        })
      )
        .json()
        .item.some((x: { id: string }) => x.id === c.id),
    ).toBe(true);
    expect(presigns).toBe(1);
  } finally {
    await app.close();
  }
});

it.skipIf(!process.env.II_TONYA_PRIVATE_PARSER_TEST_SOCKET)(
  "normal worker composes real local Telegram/S3/VK and isolated extraction without approval authority",
  async () => {
    const { createServer } = await import("node:http");
    const { readFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const { createResidentPrivateJobsRunner } =
      await import("../../packages/worker/src/resident-private-jobs.js");
    const {
      createPrivateObjectStore,
      createTelegramDocumentReader,
      createVkWallReader,
    } =
      await import("../../packages/integrations/src/documents/private-verification.js");
    const { createIsolatedDocumentParser } =
      await import("../../packages/integrations/src/documents/isolated-document-parser.js");
    const bytes = await readFile(
        "/tmp/residency-private-parser-20261026/text.pdf",
      ),
      sha = createHash("sha256").update(bytes).digest("hex");
    let putId = "";
    const now = Math.floor(Date.now() / 1000);
    const server = createServer((q, s) => {
      if (q.url!.endsWith("/getFile")) {
        s.end(
          JSON.stringify({
            ok: true,
            result: {
              file_id: "worker_pdf",
              file_size: bytes.length,
              file_path: "documents/worker.pdf",
            },
          }),
        );
      } else if (q.url!.startsWith("/file/")) s.end(bytes);
      else if (q.url!.includes("/wall.get"))
        s.end(
          JSON.stringify({
            response: {
              count: 1,
              items: [
                { id: 1, date: now, comments: { count: 4 }, attachments: [] },
              ],
            },
          }),
        );
      else if (q.method === "PUT") {
        putId = String(q.headers["x-amz-meta-custody-id"]);
        q.resume();
        q.on("end", () => s.end());
      } else if (q.method === "HEAD") {
        s.setHeader("content-length", bytes.length);
        s.setHeader("content-type", "application/pdf");
        s.setHeader(
          "x-amz-checksum-sha256",
          Buffer.from(sha, "hex").toString("base64"),
        );
        s.setHeader("x-amz-meta-sha256", sha);
        s.setHeader("x-amz-meta-custody-id", putId);
        s.setHeader("x-amz-meta-schema", "1");
        s.end();
      } else s.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const origin =
        "http://127.0.0.1:" + (server.address() as { port: number }).port,
      transport: typeof fetch = (url, init) =>
        fetch(origin + new URL(String(url)).pathname, init);
    try {
      const a = await applicant(),
        r = new PostgresResidentPrivateJobsRepository(database.db, policy);
      await submitForJobs(a, {
        roles: ["EXPERT"],
        primaryRole: "EXPERT",
        specialization: "Психолог",
        methods: "Консультации",
        experienceYears: 12,
        averageCheckMinor: "100000",
        education: [{ ...reference, fileId: "worker_pdf", size: bytes.length }],
      });
      const runner = createResidentPrivateJobsRunner({
        repository: r,
        reader: createTelegramDocumentReader({
          botId: "717171",
          token: "717171:SYNTHETIC",
          fetch: transport,
        }),
        store: createPrivateObjectStore({
          bucket: "worker-fixture",
          region: "test-1",
          endpoint: origin,
          credentials: {
            accessKeyId: "local-access",
            secretAccessKey: "local-secret",
          },
          dedicatedNonVersionedVerified: true,
          localEvidence: true,
        }),
        social: createVkWallReader({
          token: "SYNTHETIC_VK",
          tokenKind: "service",
          fetch: transport,
        }),
        parser: createIsolatedDocumentParser({
          socketPath: process.env.II_TONYA_PRIVATE_PARSER_TEST_SOCKET!,
          ocr: true,
        }),
      });
      const report = await runner.runOnce();
      expect(report).toMatchObject({ failed: 0 });
      expect(report).toHaveProperty("documents");
      const object = (
        await database.db.execute(
          sql`select state,observation from resident_private_objects where application_id=${a.form.id}::uuid and purpose='education'`,
        )
      ).rows[0];
      expect(object).toMatchObject({
        state: "verified",
        observation: { result: "MATCH", authenticity: "unverified" },
      });
      const f = (
        await database.db.execute(
          sql`select status,submitted_draft from residents_applications where id=${a.form.id}::uuid`,
        )
      ).rows[0]!;
      expect(f.status).toBe("UNDER_REVIEW");
      expect(
        (f.submitted_draft as Record<string, unknown>).specialization,
      ).toBe("Психолог");
      const j = (
        await database.db.execute(
          sql`select result from resident_evidence_jobs where application_id=${a.form.id}::uuid`,
        )
      ).rows[0]!;
      expect(j.result).toMatchObject({
        scorePolicy: "not_configured",
        social: [{ source: "vk_api", activity: "ACTIVE", score: null }],
      });
      const cycle = runner.runOnce();
      await expect(runner.runOnce()).rejects.toThrow("private_cycle_busy");
      await cycle;
      runner.stopAccepting();
      expect(await runner.runOnce()).toEqual({ reason: "closing" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
