import { afterAll, beforeAll, expect, it } from "vitest";
import { PostgresPaymentsPilotLedger } from "../../packages/db/src/repositories/payments-pilot-ledger.js";
import {
  startTestPostgres,
  type TestDatabase,
} from "../../packages/db/src/testkit/postgres.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await startTestPostgres();
  await database.migrate();
}, 120000);
afterAll(async () => database?.stop(), 120000);

const principalId = "11111111-2222-4333-8444-555555555555";
const paymentId = "2f4b6d0d-000f-5000-9000-000000000601";

it("stores pilot payments append-only with the latest provider status (SCRUM-518)", async () => {
  const ledger = new PostgresPaymentsPilotLedger(database.db);
  expect(await ledger.find(paymentId)).toBeNull();
  await ledger.recordCreated({
    providerPaymentId: paymentId,
    principalId,
    amountMinor: 1000n,
    idempotencyKey: "6a1f0d1e-6c55-4a40-9a51-6a4d3f6b0c01",
  });
  expect(await ledger.find(paymentId)).toEqual({
    providerPaymentId: paymentId,
    principalId,
    amountMinor: 1000n,
    status: "pending",
  });
  await ledger.recordStatus({
    providerPaymentId: paymentId,
    principalId,
    status: "succeeded",
  });
  await ledger.recordStatus({
    providerPaymentId: paymentId,
    principalId,
    status: "succeeded",
  });
  expect((await ledger.find(paymentId))?.status).toBe("succeeded");
  await expect(
    ledger.recordStatus({
      providerPaymentId: paymentId,
      principalId: "99999999-2222-4333-8444-555555555555",
      status: "canceled",
    }),
  ).rejects.toThrow("payments_pilot_principal_mismatch");
  await expect(
    ledger.recordCreated({
      providerPaymentId: "not-a-uuid",
      principalId,
      amountMinor: 1000n,
      idempotencyKey: "k",
    }),
  ).rejects.toThrow("payments_pilot_record_invalid");
});
