import Fastify from "fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { browserAccountRoutes } from "./browser-account.js";
import { createErasureRequestService } from "../../../../packages/application/src/erasure-request-service.js";
import { PostgresErasureRequestRepository } from "../../../../packages/db/src/repositories/erasure-request-repository.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../../packages/db/src/testkit/postgres.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  expect(
    (await database.db.execute(sql`show server_version_num`)).rows[0],
  ).toEqual({ server_version_num: "170005" });
  await database.migrate();
}, 180000);
afterAll(async () => database?.stop());

it("preserves accepted and revoked receipts and job links across status-only API restart", async () => {
  const repository = new PostgresErasureRequestRepository(database.db);
  const service = createErasureRequestService({
    repository,
    requestEnabled: true,
  });
  const owner = await database.createUser();
  const revokedOwner = await database.createUser();
  const receipt = `er1.${"A".repeat(43)}`;
  const revokedReceipt = `er1.${"B".repeat(42)}A`;
  const accepted = await service.request({
    principalUserId: owner,
    targetUserId: owner,
    receiptToken: receipt,
  });
  expect(accepted.kind).toBe("accepted");
  expect(
    (
      await service.request({
        principalUserId: revokedOwner,
        targetUserId: revokedOwner,
        receiptToken: revokedReceipt,
      })
    ).kind,
  ).toBe("accepted");
  const jobId = randomUUID();
  await database.db.execute(
    sql`insert into privacy_deletion_jobs(id,user_id,idempotency_key,status) values(${jobId}::uuid,${owner}::uuid,'synthetic-recovery','pending')`,
  );
  await database.db.execute(
    sql`update client_erasure_requests set job_id=${jobId}::uuid where user_id=${owner}::uuid`,
  );
  await database.db.execute(
    sql`update client_erasure_requests set receipt_revoked_at=now() where user_id=${revokedOwner}::uuid`,
  );
  await database.db.execute(
    sql`update users set active=false where id=${owner}::uuid`,
  );
  const before = (
    await database.db.execute(
      sql`select * from client_erasure_requests order by id`,
    )
  ).rows;
  let previous: unknown;
  for (let restart = 0; restart < 2; restart++) {
    const recovery = createErasureRequestService({
      repository: new PostgresErasureRequestRepository(database.db),
      requestEnabled: false,
    });
    const app = Fastify();
    const sessionToken = `cs1.${"C".repeat(42)}A` as const;
    await app.register(browserAccountRoutes, {
      origin: "https://example.invalid",
      botUsername: "synthetic_bot",
      widgetEnabled: false,
      privacyEnabled: true,
      erasureRequestsEnabled: false,
      erasureRequests: recovery,
      principals: {
        resolve: async (authorization) =>
          authorization === `Bearer ${sessionToken}`
            ? {
                kind: "resolved",
                principal: {
                  userId: revokedOwner,
                  active: true,
                  authenticated: true,
                },
              }
            : { kind: "denied" },
      },
      sessions: {
        issue: async () => ({ kind: "unauthorized" }),
        revoke: async () => ({ kind: "denied" }),
      },
    });
    try {
      const probe = await app.inject({
        url: "/v1/browser/session",
        headers: { cookie: `__Host-client-session=${sessionToken}` },
      });
      expect(probe.json()).toMatchObject({
        authenticated: true,
        privacyAvailable: true,
        erasureAvailable: false,
      });
      const cookie =
        `__Host-client-session=${sessionToken}; ` +
        probe.cookies.map((value) => `${value.name}=${value.value}`).join("; ");
      const deniedCreation = await app.inject({
        method: "POST",
        url: "/v1/browser/privacy/erasure-requests",
        headers: {
          origin: "https://example.invalid",
          cookie,
          "x-csrf-token": probe.json().csrfToken,
        },
        payload: { receiptToken: receipt, confirmed: true },
      });
      expect(deniedCreation.statusCode).toBe(503);
      const read = (receiptToken: string) =>
        app.inject({
          method: "POST",
          url: "/v1/browser/privacy/erasure-status",
          headers: { origin: "https://example.invalid" },
          payload: { receiptToken },
        });
      const result = await read(receipt);
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ stage: "deleting" });
      if (accepted.kind === "accepted")
        expect(result.json().requestId).toBe(accepted.request.requestId);
      if (restart) expect(result.json()).toEqual(previous);
      previous = result.json();
      expect((await read(revokedReceipt)).statusCode).toBe(403);
      expect(
        (
          await recovery.request({
            principalUserId: revokedOwner,
            targetUserId: revokedOwner,
            receiptToken: revokedReceipt,
          })
        ).kind,
      ).toBe("unavailable");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v1/browser/privacy/erasure-requests",
            headers: { origin: "https://example.invalid" },
            payload: { receiptToken: receipt, confirmed: true },
          })
        ).statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  }
  expect(
    (
      await database.db.execute(
        sql`select * from client_erasure_requests order by id`,
      )
    ).rows,
  ).toEqual(before);
});
