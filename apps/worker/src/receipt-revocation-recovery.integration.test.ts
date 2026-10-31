import { randomUUID, createHmac } from "node:crypto";
import { createServer, type Server } from "node:net";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../../packages/db/src/testkit/postgres.js";
import { PostgresReceiptRevocationOutbox } from "../../../packages/db/src/repositories/receipt-revocation-outbox.js";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import { composeReceiptRevocationRecovery } from "./receipt-revocation-recovery.js";
let f: TestDatabase, server: Server | undefined;
beforeAll(async () => {
  f = await startTestPostgres();
  await f.db.execute(
    sql.raw(
      readFileSync(
        "docs/superpowers/implementation-artifacts/drafts/receipt_revocation_outbox.sql",
        "utf8",
      ),
    ),
  );
}, 120000);
afterAll(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  await f?.stop();
}, 120000);
it("retries a durable contact cancellation over authenticated IPC and clears the ticket only after ACK", async () => {
  const key = Buffer.alloc(32, 1),
    auth = Buffer.alloc(32, 2),
    address = `\0recovery-${randomUUID()}`,
    contact = randomUUID(),
    user = randomUUID();
  let seen: Record<string, string> | undefined;
  server = createServer((socket) =>
    socket.once("data", (helloChunk) => {
      const hello = JSON.parse(helloChunk.toString()) as { hello: string },
        challenge = "b".repeat(64),
        mac = createHmac("sha256", auth)
          .update(`hello\n${hello.hello}\n${challenge}`)
          .digest("hex");
      socket.write(
        JSON.stringify({ nonce: hello.hello, challenge, mac }) + "\n",
      );
      socket.once("data", (chunk) => {
        const envelope = JSON.parse(chunk.toString()) as {
          nonce: string;
          body: string;
        };
        seen = JSON.parse(envelope.body);
        const outcome = "erased",
          mac = createHmac("sha256", auth)
            .update(`response\n${envelope.nonce}\n${challenge}\n${outcome}`)
            .digest("hex");
        socket.end(
          JSON.stringify({ nonce: envelope.nonce, challenge, outcome, mac }) +
            "\n",
        );
      });
    }),
  );
  await new Promise<void>((resolve, reject) =>
    server!.once("error", reject).listen(address, resolve),
  );
  const gateway = new ExperimentalGatewayIpc({
      address,
      key,
      authKey: auth,
      timeoutMs: 500,
    }),
    token = gateway.contactToken(contact);
  await f.db.execute(
    sql`insert into receipt_revocation_outbox(subject_id,contact_id,token,key_version) values(${user}::uuid,${contact}::uuid,${token},'v1')`,
  );
  expect(
    await composeReceiptRevocationRecovery(
      new PostgresReceiptRevocationOutbox(f.db),
      gateway,
      "v1",
    )(),
  ).toBe(1);
  expect(seen).toEqual({
    op: "revoke_contact",
    subject: token,
    contact_id: contact,
  });
  expect(
    (await f.db.execute(sql`select * from receipt_revocation_outbox`)).rows,
  ).toHaveLength(0);
}, 120000);
