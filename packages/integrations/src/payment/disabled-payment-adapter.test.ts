import { describe, expect, it } from "vitest";
import {
  DisabledPaymentAdapter,
  PaymentsDisabledError,
} from "./disabled-payment-adapter.js";
import type {
  CreateCheckoutCommand,
  PaymentWebhookCommand,
  RefundCommand,
} from "./payment-port.js";

const withoutReadableProperties = <T extends object>(
  value: T,
  onRead: () => void,
): T =>
  new Proxy(value, {
    get() {
      onRead();
      throw new Error("disabled adapters must not inspect commands");
    },
  });

const expectPaymentsDisabled = async (operation: Promise<never>) => {
  try {
    await operation;
    expect.fail("disabled payment operation unexpectedly resolved");
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentsDisabledError);
    expect(error).toMatchObject({
      name: "PaymentsDisabledError",
      code: "PAYMENTS_DISABLED",
      message:
        "Live payments are disabled until a provider and commercial policy are approved",
    });
  }
};

describe("disabled payment adapter", () => {
  it("rejects checkout, webhook, and refund commands without reading input", async () => {
    const adapter = new DisabledPaymentAdapter();
    let propertyReads = 0;
    const onRead = () => {
      propertyReads += 1;
    };

    await expectPaymentsDisabled(
      adapter.createCheckout(
        withoutReadableProperties<CreateCheckoutCommand>(
          {
            userId: "u-1",
            packageCode: "p-1",
            idempotencyKey: "c-1",
          },
          onRead,
        ),
      ),
    );
    await expectPaymentsDisabled(
      adapter.acceptWebhook(
        withoutReadableProperties<PaymentWebhookCommand>(
          {
            rawBody: new Uint8Array(),
            headers: {},
          },
          onRead,
        ),
      ),
    );
    await expectPaymentsDisabled(
      adapter.refund(
        withoutReadableProperties<RefundCommand>(
          {
            externalPaymentId: "pay-1",
            idempotencyKey: "r-1",
          },
          onRead,
        ),
      ),
    );

    expect(propertyReads).toBe(0);
  });
});
