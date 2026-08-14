import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  yooKassaNotificationSchema,
  type VerifiedExpertResidencyPaymentEvent,
} from "@ii-tonya/integrations";

export interface YooKassaWebhookDependencies {
  readonly effectivePeerAddress: (request: FastifyRequest) => string;
  readonly claim: (eventKey: string) => Promise<"claimed" | "duplicate">;
  readonly verify: (
    notification: unknown,
  ) => Promise<VerifiedExpertResidencyPaymentEvent>;
  readonly deliver: (
    event: VerifiedExpertResidencyPaymentEvent,
  ) => Promise<void>;
  readonly complete: (eventKey: string) => Promise<void>;
  readonly release: (eventKey: string) => Promise<void>;
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
    normalized.startsWith("2a02:5180:")
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
      if ((await deps.claim(eventKey)) === "duplicate") {
        return reply.send({ accepted: true });
      }
      try {
        const event = await deps.verify(parsed.data);
        await deps.deliver(event);
        await deps.complete(eventKey);
        return reply.send({ accepted: true });
      } catch {
        await deps.release(eventKey);
        return reply.code(503).send({ error: "delivery_pending" });
      }
    },
  );
}
