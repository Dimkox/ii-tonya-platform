import { readFile } from "node:fs/promises";
import { createResidentPrivateJobsRunner } from "../../packages/worker/src/resident-private-jobs.js";
import {
  createTelegramDocumentReader,
  createTelegramPreviewReader,
} from "../../packages/integrations/src/documents/private-verification.js";
import { createIsolatedDocumentParser } from "../../packages/integrations/src/documents/isolated-document-parser.js";
import { createResidentPrivateJobsLifecycle } from "../../apps/worker/src/resident-private-jobs-composition.js";
import { createProductionWorkerRuntime } from "../../apps/worker/src/runtime.js";
import { runWorkerLoop } from "../../apps/worker/src/main.js";
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
  return { userId, scope, command, repo, privateJobs, form, app, send, config };
}
it("R1 delayed deletion result cannot verify a concurrently settled late PUT or downgrade a newer operation", async () => {
  const f = await fixture();
  try {
    await f.send("/brief", {
      file_id: "race",
      file_size: 32,
      mime_type: "application/pdf",
    });
    const id = String(
        (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!.id,
      ),
      upload = (await f.privateJobs.claimDocument(id))!;
    await database.db.execute(
      sql`delete from residents_applications where id=${f.form.id}::uuid`,
    );
    const deletion = await f.privateJobs.claimDeletion(id);
    expect(deletion).not.toBeNull();
    await f.privateJobs.completeDocument(upload, {
      kind: "verified",
      sha256: "a".repeat(64),
    });
    await f.privateJobs.recordDeletion(id, "absent", deletion!.token);
    expect(
      (
        await database.db.execute(
          sql`select delete_state from resident_object_deletions where custody_id=${id}::uuid`,
        )
      ).rows[0]?.delete_state,
    ).toBe("unknown");
    const next = (await f.privateJobs.claimDeletion(id))!;
    await f.privateJobs.recordDeletion(id, "absent", next.token);
    await f.privateJobs.recordDeletion(id, "unknown", deletion!.token);
    expect(
      (
        await database.db.execute(
          sql`select delete_state from resident_object_deletions where custody_id=${id}::uuid`,
        )
      ).rows[0]?.delete_state,
    ).toBe("verified");
  } finally {
    await f.app.close();
  }
});
it("R2 owner confirmation never applies a trailing field absent from its complete escaped preview", async () => {
  const f = await fixture();
  try {
    await f.send("/brief", {
      file_id: "preview",
      file_size: 32,
      mime_type: "application/pdf",
    });
    const id = String(
        (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!.id,
      ),
      claim = (await f.privateJobs.claimDocument(id))!;
    const proposal = {
      motivation: 'Я "проверяю" '.repeat(95),
      path: "Опыт \\ путь ".repeat(95),
      city: "ТРАЙЛИНГ",
    };
    await f.privateJobs.completeDocument(claim, {
      kind: "verified",
      sha256: "a".repeat(64),
      proposal,
    });
    const preview = (await f.send("/brief_status")).json().text as string;
    const confirmation = preview.match(
      /\/brief_confirm [0-9a-f-]{36} \d+/,
    )?.[0];
    if (confirmation) {
      expect(preview).toContain("ТРАЙЛИНГ");
      for (const value of Object.values(proposal))
        expect(preview).toContain(JSON.stringify(value));
    } else {
      expect(
        String((await f.send(`/brief_confirm ${id} 0`)).json().text ?? ""),
      ).not.toContain("Подтверждённые ответы сохранены");
    }
    expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(16000);
  } finally {
    await f.app.close();
  }
});
async function localTransports(bytes: Buffer, contradiction = false) {
  let custody = "";
  const server = createServer(async (q, s) => {
    let body = "";
    for await (const b of q) body += b;
    if (q.url!.endsWith("/getFile"))
      s.end(
        JSON.stringify({
          ok: true,
          result: {
            file_id: JSON.parse(body).file_id,
            file_size: bytes.length,
            file_path: "documents/fixture.pdf",
          },
        }),
      );
    else if (q.url!.startsWith("/file/")) s.end(bytes);
    else if (q.method === "PUT") {
      custody = String(q.headers["x-amz-meta-custody-id"]);
      s.end();
    } else if (q.method === "HEAD") {
      s.setHeader("content-length", bytes.length);
      s.setHeader("content-type", "application/pdf");
      s.setHeader(
        "x-amz-checksum-sha256",
        contradiction
          ? "contradiction"
          : createHash("sha256").update(bytes).digest("base64"),
      );
      s.setHeader(
        "x-amz-meta-sha256",
        createHash("sha256").update(bytes).digest("hex"),
      );
      s.setHeader("x-amz-meta-custody-id", custody);
      s.setHeader("x-amz-meta-schema", "1");
      s.end();
    } else s.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    transport: typeof fetch = (u, i) =>
      fetch(origin + new URL(String(u)).pathname, i);
  return {
    reader: createTelegramDocumentReader({
      botId: "717171",
      token: "717171:SYNTHETIC",
      fetch: transport,
    }),
    store: createPrivateObjectStore({
      bucket: "local-fixture",
      region: "test-1",
      endpoint: origin,
      credentials: {
        accessKeyId: "fixture",
        secretAccessKey: "fixture-secret",
      },
      dedicatedNonVersionedVerified: true,
      localEvidence: true,
    }),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
async function submit(
  f: Awaited<ReturnType<typeof fixture>>,
  patch: Record<string, unknown> = {},
) {
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
      ...patch,
    },
  });
  await f.repo.mutate({
    ...f.command(),
    action: "submit",
    expectedRevision: 1,
  });
  return (
    await database.db.execute<{ id: string }>(
      sql`select application_id id from expert_sales_form_bridges where form_id=${f.form.id}::uuid`,
    )
  ).rows[0]!.id;
}
for (const derived of ["specialty301", "oversized", "throws"] as const)
  it(`R3 established custody survives ${derived} derived processing`, async () => {
    const f = await fixture(),
      bytes = Buffer.from("%PDF-1.7\nsynthetic derived fixture"),
      io = await localTransports(bytes);
    try {
      await f.send("/brief", {
        file_id: "derived",
        file_size: bytes.length,
        mime_type: "application/pdf",
      });
      const runner = createResidentPrivateJobsRunner({
        repository: f.privateJobs,
        reader: io.reader,
        store: io.store,
        parser: {
          async parse() {
            if (derived === "throws") throw Error("synthetic parser failure");
            return {
              source: "pdf",
              coverage: "complete",
              content:
                derived === "specialty301"
                  ? "Специализация: " + "я".repeat(301)
                  : "Мотивация: " + "я".repeat(65000),
            };
          },
        },
      });
      await runner.runOnce();
      const row = (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!;
      expect(row.state).toBe("verified");
      const proof = (
        await database.db.execute<{ sha: string }>(
          sql`select sha256 sha from resident_private_objects where id=${String(row.id)}::uuid`,
        )
      ).rows[0]!.sha;
      expect(proof).toBe(createHash("sha256").update(bytes).digest("hex"));
      const appId = await submit(f),
        session = await managerSession();
      const grant = await f.privateJobs.managerLink(
        session,
        appId,
        String(row.id),
        (p) => io.store.presign(p),
      );
      expect(new URL(grant.url).searchParams.get("X-Amz-Expires")).toBe("120");
      expect(row.proposal).toBeNull();
      runner.stopAccepting();
    } finally {
      await io.close();
      await f.app.close();
    }
  });
it("R5 actual isolated mixed PDF without OCR preserves text/custody and yields UNKNOWN", async () => {
  const f = await fixture(),
    bytes = await readFile("/tmp/residency-private-parser-20261026/mixed.pdf"),
    io = await localTransports(bytes);
  try {
    const parser = createIsolatedDocumentParser({
        socketPath: process.env.II_TONYA_PRIVATE_PARSER_TEST_SOCKET!,
        ocr: false,
      }),
      parsed = await parser.parse({
        type: "pdf",
        bytes,
        signal: new AbortController().signal,
      });
    expect(parsed?.coverage).toBe("partial");
    expect(parsed?.content).toContain("Психолог");
    await submit(f, {
      roles: ["EXPERT"],
      primaryRole: "EXPERT",
      specialization: "Психолог",
      methods: "Консультации",
      experienceYears: 12,
      averageCheckMinor: "100000",
      education: [
        {
          kind: "document",
          fileId: "mixed",
          size: bytes.length,
          mimeType: "application/pdf",
        },
      ],
    });
    const runner = createResidentPrivateJobsRunner({
      repository: f.privateJobs,
      reader: io.reader,
      store: io.store,
      parser,
    });
    await runner.runOnce();
    expect(
      (
        await database.db.execute(
          sql`select state,sha256,observation from resident_private_objects where application_id=${f.form.id}::uuid and purpose='education'`,
        )
      ).rows[0],
    ).toMatchObject({
      state: "verified",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      observation: { result: "UNKNOWN" },
    });
    runner.stopAccepting();
  } finally {
    await io.close();
    await f.app.close();
  }
});
async function managerSession() {
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
  return session;
}
it("R6 mixed-case Telegram second generation hits the same cache and expired evidence refreshes", async () => {
  const f = await fixture(),
    io = await localTransports(Buffer.from("%PDF-fixture"));
  let reads = 0;
  const html = await readFile(
    "packages/integrations/src/documents/fixtures/telegram-public-preview.html",
  );
  const server = createServer((_q, s) => {
    reads++;
    s.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const appId = await submit(f, { socialLinks: ["https://t.me/TeLeGrAm/"] }),
      session = await managerSession(),
      origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const runner = createResidentPrivateJobsRunner({
      repository: f.privateJobs,
      reader: io.reader,
      store: io.store,
      telegramPreview: createTelegramPreviewReader({
        fetch: (_u, i) => fetch(origin, i),
      }),
    });
    await runner.runOnce();
    expect(reads).toBe(1);
    const review = new PostgresResidentReviewRepository(database.db, {
        ...policy,
        providerMode: "test",
      }),
      preview = await review.preview(session, {
        applicationId: appId,
        expectedRevision: 2,
        expectedGeneration: 1,
        key: "REQ_INFO_GENERIC",
        questions: ["Дополнение?"],
      }),
      event = await review.confirm(
        session,
        appId,
        preview.previewId,
        preview.hash,
      );
    await f.send(`/answer ${event.eventId} 1 Дополнение`);
    await f.send(`/answers_done ${event.eventId}`);
    await runner.runOnce();
    expect(reads).toBe(1);
    expect(
      (
        await database.db.execute(
          sql`select status from resident_evidence_jobs where application_id=${f.form.id}::uuid and generation=2`,
        )
      ).rows[0]?.status,
    ).toBe("complete");
    await database.db.execute(
      sql`with t as materialized(select clock_timestamp()-interval '1 hour' n) update resident_social_observations set observed_at=t.n-interval '24 hours',expires_at=t.n from t where user_id=${f.userId}::uuid`,
    );
    const old = (
      await database.db.execute<{
        result: { social: Record<string, unknown>[] };
      }>(
        sql`select result from resident_evidence_jobs where application_id=${f.form.id}::uuid and generation=2`,
      )
    ).rows[0]!.result;
    old.social[0]!.observedAt = new Date(Date.now() - 90000000).toISOString();
    old.social[0]!.expiresAt = new Date(Date.now() - 3600000).toISOString();
    await database.db.execute(
      sql`update resident_evidence_jobs set result=${JSON.stringify(old)}::jsonb where application_id=${f.form.id}::uuid and generation=2`,
    );
    await runner.runOnce();
    expect(reads).toBe(2);
    runner.stopAccepting();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await io.close();
    await f.app.close();
  }
});
for (const enabled of [false, true])
  it(`R8 actual composed application lifecycle scheduled enabled=${enabled}`, async () => {
    const f = await fixture();
    try {
      await submit(f);
      const config = {
          ...f.config,
          features: { ...f.config.features, residentPrivateJobs: enabled },
          expertApplicant: {
            ...f.config.expertApplicant!,
            botToken: "717171:SYNTHETIC",
          },
        },
        lifecycle = createResidentPrivateJobsLifecycle(config, database.db);
      expect(Boolean(lifecycle)).toBe(enabled);
      const runtime = createProductionWorkerRuntime({
        ...(lifecycle ? { residentPrivateJobs: lifecycle } : {}),
        jobsRepository: {
          processDueBatch: async () => ({}),
          expireDueBatch: async () => ({}),
          listLocalReservations: async () => [],
          recordProviderUnavailable: async () => undefined,
          materializeOperatorCasesBatch: async () => ({}),
        },
        expertReferralJobsRepository: {
          expireDueBatch: async () => ({ examined: 0, changed: 0, failed: 0 }),
          replayDueBatch: async () => ({
            examined: 0,
            granted: 0,
            cancelled: 0,
          }),
          listReconciliationBatch: async () => [],
          recordReconciliationMismatches: async () => undefined,
        },
        expertTelegramCheckoutRepository: {
          clearExpiredCheckoutUrls: async () => 0,
        },
        outboxRepository: {
          recoverExpiredDispatchLeases: async () => 0,
          recoverExpiredReconciliationLeases: async () => 0,
        },
        closeDatabase: async () => undefined,
        closeTelemetry: async () => undefined,
        now: () => new Date(),
      } as Parameters<typeof createProductionWorkerRuntime>[0]);
      const abort = new AbortController();
      let cycles = 0;
      await runWorkerLoop(runtime, {
        signal: abort.signal,
        pollIntervalMs: 1,
        heartbeat: async () => {
          cycles++;
          abort.abort();
        },
      });
      expect(cycles).toBe(1);
      const state = (
        await database.db.execute(
          sql`select status from resident_evidence_jobs where application_id=${f.form.id}::uuid and generation=1`,
        )
      ).rows[0];
      expect(state?.status).toBe(enabled ? "complete" : undefined);
      if (lifecycle)
        expect(await lifecycle.runOnce()).toEqual({ reason: "closing" });
    } finally {
      await f.app.close();
    }
  });
it("R1 two real SDK runners fence DELETE before late PUT settlement and delayed response", async () => {
  const f = await fixture(),
    bytes = Buffer.from("%PDF-1.7\nconcurrent actual fixture"),
    sha = createHash("sha256").update(bytes).digest("hex");
  let putArrived!: () => void,
    deleteArrived!: () => void,
    releasePut!: () => void,
    releaseDelete!: () => void,
    stored = false,
    custody = "",
    deletes = 0;
  const putReady = new Promise<void>((r) => (putArrived = r)),
    deleteReady = new Promise<void>((r) => (deleteArrived = r)),
    putGate = new Promise<void>((r) => (releasePut = r)),
    deleteGate = new Promise<void>((r) => (releaseDelete = r));
  const server = createServer(async (q, s) => {
    let body = "";
    for await (const b of q) body += b;
    if (q.url!.endsWith("/getFile"))
      s.end(
        JSON.stringify({
          ok: true,
          result: {
            file_id: JSON.parse(body).file_id,
            file_size: bytes.length,
            file_path: "documents/race.pdf",
          },
        }),
      );
    else if (q.url!.startsWith("/file/")) s.end(bytes);
    else if (q.method === "PUT") {
      custody = String(q.headers["x-amz-meta-custody-id"]);
      putArrived();
      await putGate;
      stored = true;
      s.end();
    } else if (q.method === "DELETE") {
      stored = false;
      if (++deletes === 1) {
        deleteArrived();
        await deleteGate;
      }
      s.end();
    } else if (q.method === "HEAD" && stored) {
      s.setHeader("content-length", bytes.length);
      s.setHeader("content-type", "application/pdf");
      s.setHeader(
        "x-amz-checksum-sha256",
        Buffer.from(sha, "hex").toString("base64"),
      );
      s.setHeader("x-amz-meta-sha256", sha);
      s.setHeader("x-amz-meta-custody-id", custody);
      s.setHeader("x-amz-meta-schema", "1");
      s.end();
    } else {
      s.statusCode = 404;
      s.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    store = createPrivateObjectStore({
      bucket: "local-fixture",
      region: "test-1",
      endpoint: origin,
      credentials: {
        accessKeyId: "fixture",
        secretAccessKey: "fixture-secret",
      },
      dedicatedNonVersionedVerified: true,
      localEvidence: true,
    }),
    reader = createTelegramDocumentReader({
      botId: "717171",
      token: "717171:SYNTHETIC",
      fetch: (u, i) => fetch(origin + new URL(String(u)).pathname, i),
    }),
    a = createResidentPrivateJobsRunner({
      repository: f.privateJobs,
      store,
      reader,
    }),
    b = createResidentPrivateJobsRunner({
      repository: f.privateJobs,
      store,
      reader,
    });
  try {
    await f.send("/brief", {
      file_id: "racing_put",
      file_size: bytes.length,
      mime_type: "application/pdf",
    });
    const workA = a.runOnce();
    await putReady;
    const privacy = new PostgresPrivacyRepository(database.db, {
        privacyMutationCapability: {
          enabled: true,
          captureManifests: async () =>
            (
              [
                "object_store",
                "selarti",
                "planerka",
                "make_projection",
              ] as const
            ).map((processor) => ({
              processor,
              ciphertext: "fixture",
              keyReference: "fixture",
              algorithm: "test-envelope-v1",
              version: "1",
              subjectDeletionKeyHash: "sha256:fixture",
            })),
          verifyEnvelope: () => true,
        },
      }),
      receipt = await privacy.startErasureAtomically({
        targetUserId: f.userId,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        pseudonym: "fixture",
      });
    await database.db.execute(
      sql`update privacy_processor_attempts set status='acknowledged',receipt_ref='fixture' where deletion_job_id=${receipt.jobId}::uuid`,
    );
    await database.db.execute(
      sql`update client_booking_erasure_work set phase='complete' where deletion_job_id=${receipt.jobId}::uuid`,
    );
    const workB = b.runOnce();
    await deleteReady;
    const token = String(
      (
        await database.db.execute(
          sql`select deletion_token from resident_object_deletions where custody_id=${custody}::uuid`,
        )
      ).rows[0]!.deletion_token,
    );
    releasePut();
    await workA;
    expect(stored).toBe(true);
    releaseDelete();
    await workB;
    expect(stored).toBe(true);
    expect(
      (
        await database.db.execute(
          sql`select delete_state from resident_object_deletions where custody_id=${custody}::uuid`,
        )
      ).rows[0]?.delete_state,
    ).toBe("unknown");
    const workflow = new PostgresPrivacyWorkflowRepository(database.db, {
        enabled: true,
      }),
      schedule = {
        policyVersion: "fixture",
        expiresNoLaterThan: new Date(Date.now() + 86400000).toISOString(),
        verificationState: "scheduled" as const,
      };
    await expect(
      workflow.completeProcessors(receipt.jobId, schedule),
    ).rejects.toThrow("Private object erasure is incomplete");
    await a.runOnce();
    expect(stored).toBe(false);
    await f.privateJobs.recordDeletion(custody, "unknown", token);
    expect(
      (
        await database.db.execute(
          sql`select delete_state from resident_object_deletions where custody_id=${custody}::uuid`,
        )
      ).rows[0]?.delete_state,
    ).toBe("verified");
    await workflow.completeProcessors(receipt.jobId, schedule);
    expect((await workflow.getJob(receipt.jobId))?.status).toBe(
      "processor_complete",
    );
  } finally {
    releasePut();
    releaseDelete();
    a.stopAccepting();
    b.stopAccepting();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.app.close();
  }
});

it("R2 complete bounded escaped preview binds exact values and rejects an intervening revision", async () => {
  const f = await fixture();
  try {
    const proposal = {
      motivation: 'Я "подтверждаю" \\ '.repeat(55),
      methods: "ПОСЛЕДНЕЕ ЗНАЧЕНИЕ",
    };
    const prepare = async (revision: number, fileId: string) => {
      await f.send("/brief", {
        file_id: fileId,
        file_size: 32,
        mime_type: "application/pdf",
      });
      const row = (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!,
        claim = (await f.privateJobs.claimDocument(String(row.id)))!;
      await f.privateJobs.completeDocument(claim, {
        kind: "verified",
        sha256: "a".repeat(64),
        proposal,
      });
      const text = String((await f.send("/brief_status")).json().text);
      for (const v of Object.values(proposal))
        expect(text).toContain(JSON.stringify(v));
      expect(text).toContain(`/brief_confirm ${row.id} ${revision}`);
      return String(row.id);
    };
    const stale = await prepare(0, "stale_preview");
    await f.repo.mutate({
      ...f.command(),
      action: "patch",
      expectedRevision: 0,
      patch: { city: "Казань" },
    });
    expect(
      String((await f.send(`/brief_confirm ${stale} 0`)).json().text),
    ).not.toContain("Подтверждённые ответы сохранены");
    expect(
      (await f.repo.mutate({ ...f.command(), action: "start" })).draft
        .motivation,
    ).toBeUndefined();
    const current = await prepare(1, "current_preview");
    expect((await f.send(`/brief_confirm ${current} 1`)).json().text).toContain(
      "Подтверждённые ответы сохранены",
    );
    expect(
      (await f.repo.mutate({ ...f.command(), action: "start" })).draft,
    ).toMatchObject(proposal);
  } finally {
    await f.app.close();
  }
});

it("R7 contradictory successful HEAD cannot establish custody or issue a manager grant", async () => {
  const f = await fixture(),
    bytes = Buffer.from("%PDF-1.7\ncontradictory proof"),
    io = await localTransports(bytes, true);
  try {
    await f.send("/brief", {
      file_id: "contradictory",
      file_size: bytes.length,
      mime_type: "application/pdf",
    });
    const runner = createResidentPrivateJobsRunner({
      repository: f.privateJobs,
      reader: io.reader,
      store: io.store,
    });
    await runner.runOnce();
    const row = (await f.privateJobs.briefStatus(f.scope, f.form.id))[0]!;
    expect(row.state).toBe("unknown");
    const appId = await submit(f),
      session = await managerSession();
    let grants = 0;
    await expect(
      f.privateJobs.managerLink(session, appId, String(row.id), async () => {
        grants++;
        return "https://never-issued.example/";
      }),
    ).rejects.toThrow("private_source_unavailable");
    expect(grants).toBe(0);
    expect(
      (
        await database.db.execute(
          sql`select * from resident_document_access_audit where custody_id=${String(row.id)}::uuid`,
        )
      ).rows,
    ).toHaveLength(0);
    runner.stopAccepting();
  } finally {
    await io.close();
    await f.app.close();
  }
});
