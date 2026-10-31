import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  PublicExpertRecovery,
  PublicExpertGatewayTransport,
  ExperimentalGatewayIpc,
  createPayerReceiptVault,
} from "@ii-tonya/integrations";
import { createPublicExpertPaymentRuntime } from "./public-expert-payment-runtime.js";
afterEach(() => vi.restoreAllMocks());
it("a fresh bound observation releases its interrupted scan slot so the next durable batch progresses", async () => {
  const first = randomUUID(),
    second = randomUUID(),
    ids: string[] = [];
  let batches = 0;
  vi.spyOn(
    PublicExpertGatewayTransport.prototype,
    "hasIncompleteScan",
  ).mockReturnValue(true);
  vi.spyOn(PublicExpertRecovery.prototype, "recover").mockImplementation(
    async (id) => {
      ids.push(id);
      // First turn was interrupted. Another valid binder can finish discovery
      // before the second turn, leaving only stale in-memory pagination progress.
      return ids.length === 1
        ? { kind: "pending" }
        : ({ kind: "observed", observation: { status: "pending" } } as never);
    },
  );
  const role = (login: string) => ({
    login,
    db: { execute: async () => ({ rows: [{ value: [] }] }) } as never,
  });
  const binder = {
    login: "binder",
    db: {
      execute: async () => ({
        rows: [{ value: [batches++ === 0 ? first : second] }],
      }),
    } as never,
  };
  const key = Buffer.alloc(32, 4),
    runtime = createPublicExpertPaymentRuntime({} as never, {
      connections: {
        onboardingSender: role("onboarding"),
        mainSender: role("main"),
        refundSender: role("refund"),
        binder,
        observations: role("observations"),
      },
      gateway: new ExperimentalGatewayIpc({
        address: "\0unused-handoff",
        key: Buffer.alloc(32, 1),
        authKey: Buffer.alloc(32, 2),
        timeoutMs: 10,
      }),
      mode: "test",
      messagingConsentPolicyVersion: "v1",
      vault: createPayerReceiptVault({
        activeKeyId: "v1",
        keys: new Map([["v1", Buffer.alloc(32, 3)]]),
      }),
      requestKey: key,
      requestKeyReference: "public:v1",
      retainedRequestKeys: new Map([["public:v1", key]]),
      returnUrl: "https://ii-tonya.ru/return",
      vatCode: 1,
    });
  try {
    await runtime.runOnce();
    await runtime.runOnce();
    await runtime.runOnce();
    expect(ids).toEqual([first, first, second]);
    expect(batches).toBe(2);
  } finally {
    await runtime.stop();
  }
});
