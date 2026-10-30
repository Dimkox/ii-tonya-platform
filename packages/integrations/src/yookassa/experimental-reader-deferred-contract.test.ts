import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { yooKassaPaymentSchema } from "./contracts.js";
import { YooKassaDeferredVerifier } from "./early-bird-deferred-verifier.js";

it("preserves deferred payment authority through Python reader and TS verifier", async () => {
  const invoiceId = "11111111-1111-4111-8111-111111111111";
  const operationId = "22222222-2222-4222-8222-222222222222";
  const userId = "33333333-3333-4333-8333-333333333333";
  const grantId = "44444444-4444-4444-8444-444444444444";
  const fixture = {
    id: "abc-123",
    status: "pending",
    paid: false,
    test: false,
    amount: { value: "10.00", currency: "RUB" },
    created_at: "2026-12-01T00:00:00Z",
    refundable: false,
    metadata: {
      order_id: invoiceId,
      operation_id: operationId,
      user_id: userId,
      purpose: "early_bird_deferred",
      stage: "onboarding",
      pricing_policy: "owner_test_10_20_v1",
      pricing_grant_id: grantId,
    },
    confirmation: {
      type: "redirect",
      confirmation_url: "https://checkout.example/pay",
    },
    customer: { email: "synthetic-canary@example.com" },
  };
  const program = `
import json, sys
sys.path.insert(0, 'scripts/experimental/yookassa_gateway')
from provider_reader import ProviderReader
class Resp:
 status=200
 def read(self, n): return sys.stdin.buffer.read(n)
class Conn:
 def request(self, *args, **kwargs): pass
 def getresponse(self): return Resp()
 def close(self): pass
r=ProviderReader(('1','s'), factory=Conn, confirmation_hosts={'checkout.example'})
print(json.dumps(r.inspect_payment('abc-123')))
`;
  const child = spawnSync("python3", ["-c", program], {
    input: JSON.stringify(fixture),
    encoding: "utf8",
    timeout: 3000,
  });
  expect(child.status).toBe(0);
  expect(child.stdout).not.toContain("synthetic-canary");
  const parsed = yooKassaPaymentSchema.parse(JSON.parse(child.stdout));
  expect(parsed.refundable).toBe(false);
  expect(parsed.confirmation?.url).toBe("https://checkout.example/pay");
  const snapshot = {
    invoiceId,
    operationId,
    userId,
    grantId,
    policy: "owner_test_10_20_v1" as const,
    stage: "onboarding" as const,
    amountMinor: "1000",
    mode: "live" as const,
    launchAt: "2027-01-10T21:00:00Z",
  };
  const verifier = new YooKassaDeferredVerifier(
    { getPayment: async () => parsed },
    { findInvoice: async () => snapshot },
  );
  const verified = await verifier.verify(invoiceId, "abc-123");
  expect(verified.stage).toBe("onboarding");
  expect(verified.amountMinor).toBe("1000");
});
