import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  yooKassaNotificationSchema,
  type YooKassaNotification,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";
import type { WebhookInbox } from "./selarti-webhook.js";

export type BoundPaymentPurpose =
  | "ONBOARDING_FEE"
  | "MAIN_SUBSCRIPTION"
  | "COMBINED_EARLY_BIRD"
  | "DEFERRED_EARLY_BIRD";
export interface YooKassaWebhookDependencies {
  /** Canonical public candidates consume the notification as a GET discovery hint.
   * A failed public verification must never enter another product's handler. */
  readonly publicPayment?: {
    handle(
      notification: YooKassaNotification,
    ): Promise<"absent" | "pending" | "complete">;
  };
  /** Production supplies the durable binding lookup; metadata never chooses a product. */
  readonly resolvePurpose?: (
    providerObjectId: string,
    event: YooKassaNotification["event"],
  ) => Promise<BoundPaymentPurpose | null>;
  readonly onboarding?: {
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  /** Handler must verify the provider object and durably settle or reconcile before returning true. */
  readonly composite?: {
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  readonly deferredRefund?: {
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  readonly deferredPayment?: {
    handle(notification: YooKassaNotification): Promise<boolean>;
  };
  readonly effectivePeerAddress: (request: FastifyRequest) => string;
  readonly inbox: WebhookInbox;
  readonly verify: (
    notification: YooKassaNotification,
  ) => Promise<VerifiedExpertResidencyPaymentEvent | null>;
  readonly deliver: (
    event: VerifiedExpertResidencyPaymentEvent,
  ) => Promise<void>;
  readonly resolveSucceeded: (
    notification: YooKassaNotification,
  ) => Promise<void>;
}

const ipv4 = (value: string): number | null => {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return octets.reduce((result, part) => result * 256 + part, 0) >>> 0;
};

const inCidr = (address: string, network: string, prefix: number): boolean => {
  const candidate = ipv4(address);
  const base = ipv4(network);
  if (candidate === null || base === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (candidate & mask) === (base & mask);
};

export const isYooKassaWebhookPeer = (address: string): boolean => {
  const normalized = address.replace(/^::ffff:/u, "").toLowerCase();
  return (
    inCidr(normalized, "185.71.76.0", 27) ||
    inCidr(normalized, "185.71.77.0", 27) ||
    inCidr(normalized, "77.75.153.0", 25) ||
    inCidr(normalized, "77.75.154.128", 25) ||
    normalized === "77.75.156.11" ||
    normalized === "77.75.156.35" ||
    (isIP(normalized) === 6 && normalized.startsWith("2a02:5180:"))
  );
};

export async function yookassaWebhookRoutes(
  app: FastifyInstance,
  deps: YooKassaWebhookDependencies,
): Promise<void> {
  app.post(
    "/v1/webhooks/yookassa",
    { bodyLimit: 64 * 1024 },
    async (request, reply) => {
      if (!isYooKassaWebhookPeer(deps.effectivePeerAddress(request))) {
        return reply.code(403).send({ error: "request_rejected" });
      }
      const parsed = yooKassaNotificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const eventKey = createHash("sha256")
        .update(`${parsed.data.event}\0${parsed.data.object.id}`, "utf8")
        .digest("hex");
      const claim = await deps.inbox.claim("yookassa", eventKey);
      if (claim.kind === "duplicate") {
        return reply.send({ accepted: true });
      }
      if (claim.kind === "busy") {
        return reply.code(503).send({ error: "delivery_pending" });
      }
      try {
        if (deps.publicPayment) {
          const result = await deps.publicPayment.handle(parsed.data);
          if (result === "pending")
            throw Error("yookassa_public_payment_pending");
          if (result === "complete") {
            await deps.inbox.complete(claim.claimId);
            return reply.send({ accepted: true });
          }
        }
        if (deps.resolvePurpose) {
          const purpose = await deps.resolvePurpose(
            parsed.data.object.id,
            parsed.data.event,
          );
          if (purpose === null)
            throw new Error("yookassa_webhook_binding_pending");
          if (purpose === "ONBOARDING_FEE") {
            if (
              !deps.onboarding ||
              !(await deps.onboarding.handle(parsed.data))
            )
              throw new Error("yookassa_webhook_onboarding_pending");
            await deps.inbox.complete(claim.claimId);
            return reply.send({ accepted: true });
          }
          if (purpose === "COMBINED_EARLY_BIRD") {
            if (!deps.composite || !(await deps.composite.handle(parsed.data)))
              throw new Error("yookassa_webhook_composite_pending");
            await deps.inbox.complete(claim.claimId);
            return reply.send({ accepted: true });
          }
          if (purpose === "DEFERRED_EARLY_BIRD") {
            const handler =
              parsed.data.event === "refund.succeeded"
                ? deps.deferredRefund
                : deps.deferredPayment;
            if (!handler || !(await handler.handle(parsed.data)))
              throw new Error("yookassa_webhook_deferred_refund_pending");
            await deps.inbox.complete(claim.claimId);
            return reply.send({ accepted: true });
          }
          if (purpose !== "MAIN_SUBSCRIPTION")
            throw new Error("yookassa_webhook_purpose_invalid");
        } else if (
          deps.onboarding &&
          (await deps.onboarding.handle(parsed.data))
        ) {
          // Compatibility for existing injected test/legacy capabilities. Normal
          // composition supplies resolvePurpose and cannot take this fallback.
          await deps.inbox.complete(claim.claimId);
          return reply.send({ accepted: true });
        }
        const event = await deps.verify(parsed.data);
        // A terminal payment/refund notification without verified ownership is retryable.
        // In particular, an early callback must survive provider binding commit.
        if (
          event === null &&
          (parsed.data.event === "payment.succeeded" ||
            parsed.data.event === "refund.succeeded")
        )
          throw new Error("yookassa_webhook_pending");
        if (event !== null) {
          await deps.deliver(event);
          await deps.resolveSucceeded(parsed.data);
        }
        await deps.inbox.complete(claim.claimId);
        return reply.send({ accepted: true });
      } catch {
        try {
          await deps.inbox.fail(claim.claimId);
        } catch {
          // The lease may have expired; the provider must still receive a retryable response.
        }
        return reply.code(503).send({ error: "delivery_pending" });
      }
    },
  );
}
