import { describe, expect, it } from "vitest";
import { assertPaymentsPilotAllowed } from "./payments-pilot.js";
import { createYooKassaClient } from "./client.js";

const pilot = { principalId: "42", maxAmountMinor: 1000n };

describe("payments pilot guard (SCRUM-518)", () => {
  it("allows only the allow-listed principal up to the cap", () => {
    expect(() =>
      assertPaymentsPilotAllowed(pilot, {
        principalId: "42",
        amountMinor: 1000n,
      }),
    ).not.toThrow();
    expect(() =>
      assertPaymentsPilotAllowed(pilot, {
        principalId: "43",
        amountMinor: 1000n,
      }),
    ).toThrow("payments_pilot_refused:principal");
    expect(() =>
      assertPaymentsPilotAllowed(pilot, {
        principalId: "42",
        amountMinor: 1001n,
      }),
    ).toThrow("payments_pilot_refused:amount");
    expect(() =>
      assertPaymentsPilotAllowed(pilot, { principalId: "42", amountMinor: 0n }),
    ).toThrow("payments_pilot_refused:amount");
  });

  it("YooKassa client refuses amounts over the cap before any request", async () => {
    let calls = 0;
    const client = createYooKassaClient(
      {
        mode: "live",
        shopId: "123",
        secretKey: "fixture-key-1",
        maxPaymentAmountMinor: 1000n,
      },
      async () => {
        calls += 1;
        return new Response("{}", { status: 500 });
      },
    );
    await expect(
      client.createPayment({
        amountMinor: 1001n,
        idempotencyKey: "pilot-test-key-0001",
        description: "x",
        returnUrl: "https://ii-tonya.ru/r",
        metadata: {},
        receipt: undefined as never,
      }),
    ).rejects.toThrow("yookassa_pilot_amount_exceeded");
    expect(calls).toBe(0);
  });
});
