import type { VerifiedExpertResidencyPaymentEvent } from "../expert-residency/verified-event.js";
import type { YooKassaNotification } from "./contracts.js";
import type {
  YooKassaOperationPort,
  YooKassaOperationKind,
} from "./operation-port.js";
import type { YooKassaPaymentVerifier } from "./verifier.js";

type OperationLookup = Pick<
  YooKassaOperationPort,
  "findByProviderObject" | "resolve"
>;
type AuthoritativeVerifier = Pick<
  YooKassaPaymentVerifier,
  "verifyPayment" | "verifyRefund"
>;

export class YooKassaWebhookCapability {
  constructor(
    private readonly operations: OperationLookup,
    private readonly verifier: AuthoritativeVerifier,
  ) {}

  async verify(
    notification: YooKassaNotification,
  ): Promise<VerifiedExpertResidencyPaymentEvent | null> {
    const kind: YooKassaOperationKind =
      notification.event === "refund.succeeded"
        ? "create_refund"
        : "create_payment";
    const operation = await this.operations.findByProviderObject(
      notification.object.id,
      kind,
    );
    if (operation === null)
      throw new Error("yookassa_webhook_binding_not_found");
    if (
      operation.status === "failed" ||
      (notification.event !== "payment.canceled" &&
        operation.status === "canceled")
    ) {
      throw new Error("yookassa_webhook_binding_mismatch");
    }

    const event =
      kind === "create_refund"
        ? await this.verifier.verifyRefund(operation)
        : await this.verifier.verifyPayment(operation);
    if (event !== null) {
      const expectedKind =
        notification.event === "payment.succeeded"
          ? "settled"
          : notification.event === "refund.succeeded"
            ? "refunded"
            : null;
      if (expectedKind === null || event.kind !== expectedKind) {
        throw new Error("yookassa_webhook_binding_mismatch");
      }
      return event;
    }

    if (notification.event !== "payment.canceled") {
      throw new Error("yookassa_webhook_pending");
    }
    const refreshed = await this.operations.findByProviderObject(
      notification.object.id,
      kind,
    );
    if (refreshed?.status !== "canceled") {
      throw new Error("yookassa_webhook_pending");
    }
    return null;
  }

  async resolveSucceeded(notification: YooKassaNotification): Promise<void> {
    if (notification.event === "payment.canceled") {
      throw new Error("yookassa_webhook_binding_mismatch");
    }
    const kind: YooKassaOperationKind =
      notification.event === "refund.succeeded"
        ? "create_refund"
        : "create_payment";
    const operation = await this.operations.findByProviderObject(
      notification.object.id,
      kind,
    );
    if (operation === null) {
      throw new Error("yookassa_webhook_binding_not_found");
    }
    if (operation.status === "succeeded") return;
    await this.operations.resolve(operation.id, "succeeded");
  }
}
