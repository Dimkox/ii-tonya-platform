import {
  PostgresPrivacyRepository,
  PostgresPrivacyWorkflowRepository,
} from "../../packages/db/src/repositories/privacy-repository.js";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { createPrivateObjectStore } from "../../packages/integrations/src/documents/private-verification.js";
import { sql } from "drizzle-orm";
import { beforeAll, afterAll, expect, it } from "vitest";
import {
  startExpertReferralTestDatabase,
  type ExpertReferralTestDatabase,
} from "../../packages/db/src/testkit/expert-referral.js";
import { seedClientConsent } from "../../packages/db/src/testkit/client-consent.js";
import { PostgresResidentVerificationRepository } from "../../packages/db/src/repositories/resident-verification-repository.js";
import { PostgresResidentPrivateJobsRepository } from "../../packages/db/src/repositories/resident-private-jobs-repository.js";
import { PostgresResidentReviewRepository } from "../../packages/db/src/repositories/resident-review-repository.js";
import { PostgresExpertSeparatedSalesRepository } from "../../packages/db/src/repositories/expert-separated-sales-repository.js";
import { saveExpertOfferProfile } from "../../packages/db/src/repositories/expert-offer-v2.js";
import { loadEnv } from "../../packages/config/src/env.js";
import { createExpertApplicantComposition } from "../../apps/api/src/expert-applicant-composition.js";
import { expertApplicantTelegramRoutes } from "../../apps/api/src/routes/expert-applicant-telegram.js";
let database: ExpertReferralTestDatabase, tariff: string;
let update = 1;
beforeAll(async () => {
  database = await startExpertReferralTestDatabase();
  tariff = await database.createResidencyTariff({
    tariffKey: "PRO",
    displayName: "PRO",
    priceMinor: 999000,
    durationSeconds: 2592000,
  });
}, 120000);
afterAll(async () => {
  await database?.stop();
}, 120000);
const policy = { messagingConsentPolicyVersion: "client-messaging-v1" };
async function fixture() {
  const userId = await database.createUser(),
    chat = String(Math.floor(Math.random() * 1e12) + 1),
    scope = {
      botId: "717171",
      botKey: "private-ingress",
      telegramUserId: chat,
      chatId: chat,
    };
  await database.db.execute(
    sql`insert into channel_identities(user_id,provider,external_id,external_chat_id,bot_key,status) values(${userId}::uuid,'telegram',${chat},${chat},${scope.botKey},'active')`,
  );
  await seedClientConsent(database.db, userId, "client_messaging");
  await saveExpertOfferProfile(database.db, {
    userId,
    cityCode: "kazan",
    millionCity: false,
    serviceFormat: "offline",
    ticketMinor: "300000",
    participantKind: "expert",
    idempotencyKey: randomUUID(),
  });
  const command = () => ({
      ...scope,
      requestKey: randomUUID(),
      requestDigest: "a".repeat(64),
    }),
    sales = new PostgresExpertSeparatedSalesRepository(database.db, {
      ...scope,
      ...policy,
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
      ...scope,
      ...policy,
    }),
    privateJobs = new PostgresResidentPrivateJobsRepository(
      database.db,
      policy,
    ),
    form = await repo.mutate({ ...command(), action: "start" });
  const config = loadEnv({
    DATABASE_URL: "postgresql://synthetic:synthetic@localhost/fixture",
    ALLOW_INSECURE_LOCAL_DATABASE: "true",
    EXPERT_APPLICANT_ENABLED: "true",
    EXPERT_VERIFICATION_FORM_ENABLED: "true",
    EXPERT_SEPARATED_SALES_ENABLED: "true",
    EXPERT_PROMO_TELEGRAM_BOT_ID: scope.botId,
    EXPERT_PROMO_TELEGRAM_BOT_KEY: scope.botKey,
    EXPERT_PROMO_TELEGRAM_WEBHOOK_SECRET:
      "synthetic_private_ingress_secret_123456",
    EXPERT_PROMO_MESSAGING_CONSENT_POLICY_VERSION:
      policy.messagingConsentPolicyVersion,
    RESIDENT_PRIVATE_JOBS_ENABLED: "true",
    PRIVATE_BUCKET_NON_VERSIONED_VERIFIED: "true",
    PRIVATE_BUCKET: "local-fixture",
    PRIVATE_REGION: "test-1",
    PRIVATE_ENDPOINT: "https://private-storage.example.test",
    PRIVATE_ACCESS_KEY_ID: "local-access",
    PRIVATE_SECRET_ACCESS_KEY: "local-secret",
  });
  const Fastify = createRequire(
    new URL("../../apps/api/package.json", import.meta.url),
  )(
    "fastify",
  ) as typeof import("../../apps/api/node_modules/fastify/fastify.js").default;
  const app = Fastify({ logger: false });
  await app.register(expertApplicantTelegramRoutes, {
    enabled: true,
    capability: createExpertApplicantComposition(database.db, config)!,
  });
  const send = async (
    text: string,
    document?: { file_id: string; file_size: number; mime_type: string },
    secret = config.expertApplicant!.webhookSecret,
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/webhooks/telegram/expert-promo/" + scope.botKey,
      headers: { "x-telegram-bot-api-secret-token": secret },
      payload: {
        update_id: update++,
        message: {
          from: { id: Number(chat) },
          chat: { id: Number(chat), type: "private" },
          ...(document?.mime_type === "image/jpeg"
            ? {
                photo: [
                  {
                    file_id: document.file_id,
                    file_size: document.file_size,
                    width: 100,
                    height: 100,
                  },
                ],
                caption: text,
              }
            : document
              ? { document, caption: text }
              : { text }),
        },
      },
    });
  return { userId, scope, command, repo, privateJobs, form, app, send };
}
it("actual authenticated Telegram composition receives a dedicated brief and confirms only the owner proposal", async () => {
  const f = await fixture();
  try {
    const document = {
      file_id: "private_brief_ingress",
      file_size: 32,
      mime_type: "application/pdf",
    };
    expect((await f.send("/brief", document, "wrong")).statusCode).toBe(401);
    const accepted = await f.send("/brief", document);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().text).toContain("приватной обработки");
    const rows = await f.privateJobs.briefStatus(f.scope, f.form.id);
    expect(rows).toHaveLength(1);
    const id = String(rows[0]!.id),
      claim = (await f.privateJobs.claimDocument(id))!;
    await f.privateJobs.completeDocument(claim, {
      kind: "verified",
      sha256: "a".repeat(64),
      proposal: { city: "Казань" },
    });
    const preview = await f.send("/brief_status");
    expect(preview.json().text).toContain("/brief_confirm");
    expect(
      (await f.repo.mutate({ ...f.command(), action: "start" })).draft,
    ).toEqual({});
    const confirmed = await f.send(`/brief_confirm ${id} 0`);
    expect(confirmed.json().text).toContain("сохранены");
    expect(
      (await f.repo.mutate({ ...f.command(), action: "start" })).draft.city,
    ).toBe("Казань");
    expect(
      String((await f.send(`/brief_confirm ${id} 0`)).json().text ?? ""),
    ).not.toContain("Подтверждённые ответы сохранены");
  } finally {
    await f.app.close();
  }
});
it("paged generation materialization retains photo then text and later documents without reading future requests", async () => {
  const f = await fixture();
  try {
    await f.repo.mutate({
      ...f.command(),
      action: "patch",
      expectedRevision: 0,
      patch: {
        roles: ["OTHER"],
        primaryRole: "OTHER",
        category: "BASIC",
        tax: "INDIVIDUAL_NO_STATUS",
        city: "Онлайн",
        socialLinks: ["https://example.com/"],
        motivation: "Практика",
        path: "Путь",
        cases: "Описание",
      },
    });
    await f.repo.mutate({
      ...f.command(),
      action: "submit",
      expectedRevision: 1,
    });
    const applicationId = (
      await database.db.execute<{ id: string }>(
        sql`select application_id id from expert_sales_form_bridges where form_id=${f.form.id}::uuid`,
      )
    ).rows[0]!.id;
    const manager = await database.createUser(),
      session =
        "sha256:" +
        randomUUID().replaceAll("-", "") +
        randomUUID().replaceAll("-", "");
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
    );
    const review = new PostgresResidentReviewRepository(database.db, {
        ...policy,
        providerMode: "test",
      }),
      preview = await review.preview(session, {
        applicationId,
        expectedRevision: 2,
        expectedGeneration: 1,
        key: "REQ_INFO_GENERIC",
        questions: ["Опыт и документы?"],
      }),
      event = await review.confirm(
        session,
        applicationId,
        preview.previewId,
        preview.hash,
      );
    const send = async (
      text: string,
      document?: { file_id: string; file_size: number; mime_type: string },
    ) => {
      const response = await f.send(text, document);
      expect(response.statusCode).toBe(200);
      return response.json();
    };
    await send(`/answer ${event.eventId} 1 Первый файл`, {
      file_id: "first_photo",
      file_size: 32,
      mime_type: "image/jpeg",
    });
    for (let n = 0; n < 11; n++)
      await send(`/answer ${event.eventId} 1 Дополнение ${n}`);
    await send(`/answer ${event.eventId} 1 Последний файл`, {
      file_id: "later_document",
      file_size: 32,
      mime_type: "application/pdf",
    });
    await send(`/answers_done ${event.eventId}`);
    await f.privateJobs.listEvidenceJobs();
    const claim = await f.privateJobs.claimEvidence(f.form.id, 2);
    expect(claim).not.toBeNull();
    await f.privateJobs.completeEvidence(claim!, []);
    for (let n = 0; n < 7; n++)
      await f.privateJobs.materializeEvidenceDocuments(f.form.id, 2);
    const refs = (
      await database.db.execute<{ reference: { fileId: string } }>(
        sql`select reference from resident_private_objects where application_id=${f.form.id}::uuid and generation=2 order by source_revision`,
      )
    ).rows;
    expect(refs.map((x) => x.reference.fileId)).toEqual([
      "first_photo",
      "later_document",
    ]);
    expect(
      (
        await database.db.execute(
          sql`select documents_materialized,document_cursor from resident_evidence_jobs where application_id=${f.form.id}::uuid and generation=2`,
        )
      ).rows[0]?.documents_materialized,
    ).toBe(true);
    // Repeated materialization never duplicates allocated keys.
    await f.privateJobs.materializeEvidenceDocuments(f.form.id, 2);
    expect(
      (
        await database.db.execute(
          sql`select id from resident_private_objects where application_id=${f.form.id}::uuid`,
        )
      ).rows,
    ).toHaveLength(2);
  } finally {
    await f.app.close();
  }
});

for (const withdrawalFirst of [false, true])
  it(`physical deletion fences the existing erasure receipt (withdrawal first: ${withdrawalFirst})`, async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.send("/brief", {
            file_id: "erase_brief",
            file_size: 32,
            mime_type: "application/pdf",
          })
        ).statusCode,
      ).toBe(200);
      const custody = String(
          (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!.id,
        ),
        claim = (await f.privateJobs.claimDocument(custody))!;
      await f.privateJobs.completeDocument(claim, {
        kind: "verified",
        sha256: "a".repeat(64),
      });
      const processors = [
        "object_store",
        "selarti",
        "planerka",
        "make_projection",
      ] as const;
      const privacy = new PostgresPrivacyRepository(database.db, {
        privacyMutationCapability: {
          enabled: true,
          captureManifests: async () =>
            processors.map((processor) => ({
              processor,
              ciphertext: `ciphertext:${processor}`,
              keyReference: `test-key:${processor}`,
              algorithm: "test-envelope-v1",
              version: "1",
              subjectDeletionKeyHash: `sha256:${processor}`,
            })),
          verifyEnvelope: () => true,
        },
      });
      if (withdrawalFirst) {
        await privacy.withdrawConsentAtomically({
          targetUserId: f.userId,
          purpose: "client_messaging",
          policyVersion: policy.messagingConsentPolicyVersion,
          correlationId: randomUUID(),
        });
        expect(
          (
            await database.db.execute(
              sql`select id from resident_private_objects where id=${custody}::uuid`,
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (
            await database.db.execute(
              sql`select subject_erasure_key,deletion_job_id from resident_object_deletions where custody_id=${custody}::uuid`,
            )
          ).rows[0],
        ).toMatchObject({
          subject_erasure_key: expect.stringMatching(/^[a-f0-9]{64}$/),
          deletion_job_id: null,
        });
      }
      const command = {
        targetUserId: f.userId,
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        pseudonym: "test-private-erasure",
      };
      const receipt = await privacy.startErasureAtomically(command),
        workflow = new PostgresPrivacyWorkflowRepository(database.db, {
          enabled: true,
        });
      expect(
        (
          await database.db.execute(
            sql`select subject_erasure_key,deletion_job_id,erased from resident_object_deletions where custody_id=${custody}::uuid`,
          )
        ).rows[0],
      ).toEqual({
        subject_erasure_key: null,
        deletion_job_id: receipt.jobId,
        erased: true,
      });
      await database.db.execute(
        sql`update privacy_processor_attempts set status='acknowledged',receipt_ref='synthetic' where deletion_job_id=${receipt.jobId}::uuid`,
      );
      await database.db.execute(
        sql`update client_booking_erasure_work set phase='complete' where deletion_job_id=${receipt.jobId}::uuid`,
      );
      const schedule = {
        verificationState: "scheduled" as const,
        policyVersion: "private-test-v1",
        expiresNoLaterThan: new Date(Date.now() + 86400000).toISOString(),
      };
      await expect(
        workflow.completeProcessors(receipt.jobId, schedule),
      ).rejects.toThrow("Private object erasure is incomplete");
      await expect(
        database.db.execute(
          sql`update privacy_deletion_jobs set status='processor_complete' where id=${receipt.jobId}::uuid`,
        ),
      ).rejects.toThrow();
      expect((await privacy.startErasureAtomically(command)).status).toBe(
        "pending",
      );
      await f.privateJobs.recordDeletion(
        custody,
        "unknown",
        (await f.privateJobs.claimDeletion(custody))!.token,
      );
      await expect(
        workflow.completeProcessors(receipt.jobId, schedule),
      ).rejects.toThrow("Private object erasure is incomplete");
      await f.privateJobs.recordDeletion(
        custody,
        "absent",
        (await f.privateJobs.claimDeletion(custody))!.token,
      );
      await workflow.completeProcessors(receipt.jobId, schedule);
      expect((await workflow.getJob(receipt.jobId))?.status).toBe(
        "processor_complete",
      );
      expect((await privacy.startErasureAtomically(command)).status).toBe(
        "processor_complete",
      );
    } finally {
      await f.app.close();
    }
  });
it("manager keyset pages expose all retained documents and erased keys", async () => {
  const f = await fixture();
  try {
    await f.send("/brief", {
      file_id: "page_seed",
      file_size: 32,
      mime_type: "application/pdf",
    });
    await f.repo.mutate({
      ...f.command(),
      action: "patch",
      expectedRevision: 0,
      patch: {
        roles: ["OTHER"],
        primaryRole: "OTHER",
        category: "BASIC",
        tax: "INDIVIDUAL_NO_STATUS",
        city: "Онлайн",
        socialLinks: ["https://example.com/"],
        motivation: "Практика",
        path: "Путь",
        cases: "Описание",
      },
    });
    await f.repo.mutate({
      ...f.command(),
      action: "submit",
      expectedRevision: 1,
    });
    const applicationId = (
      await database.db.execute<{ id: string }>(
        sql`select application_id id from expert_sales_form_bridges where form_id=${f.form.id}::uuid`,
      )
    ).rows[0]!.id;
    const manager = await database.createUser(),
      session =
        "sha256:" +
        randomUUID().replaceAll("-", "") +
        randomUUID().replaceAll("-", "");
    await database.db.execute(
      sql`insert into admin_sessions(session_id_hash,admin_id,mfa_verified_at,expires_at) values(${session},${manager}::uuid,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
    );
    await database.db.execute(
      sql`insert into admin_role_assignments(admin_id,role) values(${manager}::uuid,'support')`,
    );
    await database.db.execute(
      sql`with seed as(select o.*,d.subject_erasure_key from resident_private_objects o join resident_object_deletions d on d.custody_id=o.id where o.application_id=${f.form.id}::uuid limit 1), keys as(insert into resident_object_deletions(custody_id,object_key,subject_erasure_key) select generated.id,'custody/'||generated.id,seed.subject_erasure_key from seed cross join lateral(select gen_random_uuid() id from generate_series(1,60)) generated returning custody_id) insert into resident_private_objects(id,application_id,generation,source_revision,purpose,reference,consent_authority) select keys.custody_id,seed.application_id,0,0,'brief',jsonb_set(seed.reference,'{fileId}',to_jsonb(keys.custody_id::text)),seed.consent_authority from keys cross join seed`,
    );
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const page = await f.privateJobs.managerObjects(
        session,
        applicationId,
        after,
      );
      ids.push(...page.map((x) => String(x.id)));
      after = page.length === 30 ? String(page.at(-1)!.id) : undefined;
    } while (after);
    expect(new Set(ids).size).toBe(61);
    await database.db.execute(
      sql`delete from residents_applications where id=${f.form.id}::uuid`,
    );
    const recovered: string[] = [];
    after = undefined;
    do {
      const page = await f.privateJobs.recoveryList(session, after);
      recovered.push(...page.map((x) => String(x.id)));
      after = page.length === 50 ? String(page.at(-1)!.id) : undefined;
    } while (after);
    expect(ids.every((id) => recovered.includes(id))).toBe(true);
  } finally {
    await f.app.close();
  }
});
it("real SDK late PUT after DELETE and HEAD404 retains responsibility without resurrecting private state", async () => {
  const f = await fixture(),
    bytes = Buffer.from("%PDF-1.7\nlate fixture\n"),
    digest = createHash("sha256").update(bytes).digest("hex");
  let stored = false,
    received!: () => void,
    commit!: () => void;
  const arrived = new Promise<void>((r) => (received = r)),
    release = new Promise<void>((r) => (commit = r));
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    if (req.method === "PUT") {
      received();
      await release;
      stored = true;
      res.end();
    } else if (req.method === "DELETE") {
      stored = false;
      res.end();
    } else if (!stored) {
      res.statusCode = 404;
      res.end();
    } else {
      res.setHeader("content-length", bytes.length);
      res.setHeader("content-type", "application/pdf");
      res.setHeader(
        "x-amz-checksum-sha256",
        Buffer.from(digest, "hex").toString("base64"),
      );
      res.setHeader("x-amz-meta-sha256", digest);
      res.setHeader(
        "x-amz-meta-custody-id",
        String(req.url).split("/").at(-1)!,
      );
      res.setHeader("x-amz-meta-schema", "1");
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await f.send("/brief", {
      file_id: "late_put",
      file_size: bytes.length,
      mime_type: "application/pdf",
    });
    const id = String(
        (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!.id,
      ),
      claim = (await f.privateJobs.claimDocument(id))!,
      proof = {
        key: claim.key,
        custodyId: id,
        sha256: digest,
        size: bytes.length,
        mimeType: "application/pdf",
      };
    const store = createPrivateObjectStore({
      bucket: "local-fixture",
      region: "test-1",
      endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      credentials: {
        accessKeyId: "local-access",
        secretAccessKey: "local-secret",
      },
      dedicatedNonVersionedVerified: true,
      localEvidence: true,
    });
    const abort = new AbortController(),
      pending = store.put({ ...proof, bytes, signal: abort.signal });
    await arrived;
    abort.abort();
    expect((await pending).kind).toBe("unknown");
    await f.privateJobs.completeDocument(claim, { kind: "unknown" });
    await database.db.execute(
      sql`delete from residents_applications where id=${f.form.id}::uuid`,
    );
    expect(await store.remove(claim.key, new AbortController().signal)).toBe(
      "deleted",
    );
    expect((await store.head(proof, new AbortController().signal)).kind).toBe(
      "absent",
    );
    await f.privateJobs.recordDeletion(
      id,
      "absent",
      (await f.privateJobs.claimDeletion(id))!.token,
    );
    expect(
      (
        await database.db.execute(
          sql`select delete_state from resident_object_deletions where custody_id=${id}::uuid`,
        )
      ).rows[0]?.delete_state,
    ).toBe("unknown");
    commit();
    await release;
    await new Promise<void>((r) => setImmediate(r));
    expect((await store.head(proof, new AbortController().signal)).kind).toBe(
      "verified",
    );
    await f.privateJobs.completeDocument(claim, {
      kind: "verified",
      sha256: digest,
    });
    expect(
      (
        await database.db.execute(
          sql`select id from resident_private_objects where id=${id}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    await store.remove(claim.key, new AbortController().signal);
    expect((await store.head(proof, new AbortController().signal)).kind).toBe(
      "absent",
    );
    await f.privateJobs.recordDeletion(
      id,
      "absent",
      (await f.privateJobs.claimDeletion(id))!.token,
    );
    expect(
      (
        await database.db.execute(
          sql`select delete_state,subject_erasure_key from resident_object_deletions where custody_id=${id}::uuid`,
        )
      ).rows[0],
    ).toEqual({ delete_state: "verified", subject_erasure_key: null });
  } finally {
    commit();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.app.close();
  }
});
