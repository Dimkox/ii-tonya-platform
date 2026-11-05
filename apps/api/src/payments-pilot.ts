import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ClientPrincipalResolver } from "@ii-tonya/application";
import type { RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresPaymentsPilotLedger,
  PostgresWebhookInboxRepository,
  type DrizzleDb,
  type PaymentsPilotLedger,
  type PaymentsPilotRecord,
} from "@ii-tonya/db";
import {
  assertPaymentsPilotAllowed,
  createYooKassaClient,
  formatRubMinor,
  PaymentsPilotRefusedError,
  type PaymentsPilotPolicy,
  type YooKassaClient,
  type YooKassaNotification,
  type YooKassaTransport,
  type YooKassaVatCode,
} from "@ii-tonya/integrations";
import { resolveClientPrincipal } from "./client-principal-resolver.js";
import type { YooKassaWebhookDependencies } from "./routes/yookassa-webhook.js";
import { effectivePeerAddress } from "./yookassa-peer.js";

/** SCRUM-518: the only metadata purpose the pilot creates and accepts. */
export const PAYMENTS_PILOT_PURPOSE = "payments_pilot";
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,63}$/u;

export interface PaymentsPilotServiceDependencies {
  readonly client: Pick<YooKassaClient, "createPayment" | "getPayment">;
  readonly ledger: PaymentsPilotLedger;
  readonly pilot: PaymentsPilotPolicy;
  readonly returnUrl: string;
  readonly receipt: {
    readonly vatCode: YooKassaVatCode;
    readonly paymentSubject: string;
    readonly paymentMode: string;
  };
  readonly newIdempotencyKey?: () => string;
}

export interface PaymentsPilotCheckoutResult {
  readonly paymentId: string;
  readonly confirmationUrl: string;
  readonly amountMinor: bigint;
}

/** Minimal live-shop pilot: one allow-listed principal, a capped amount, and a
 * provider-verified status ledger. Every status comes from a fresh getPayment. */
export class PaymentsPilotService {
  private readonly newKey: () => string;
  constructor(private readonly deps: PaymentsPilotServiceDependencies) {
    this.newKey = deps.newIdempotencyKey ?? randomUUID;
  }

  async checkout(input: {
    principalId: string;
    email: string;
  }): Promise<PaymentsPilotCheckoutResult> {
    const amountMinor = this.deps.pilot.maxAmountMinor;
    assertPaymentsPilotAllowed(this.deps.pilot, {
      principalId: input.principalId,
      amountMinor,
    });
    if (!EMAIL.test(input.email))
      throw new Error("payments_pilot_email_invalid");
    const operation = await this.deps.ledger.beginCheckout({
      principalId: input.principalId,
      amountMinor,
      idempotencyKey: this.newKey(),
    });
    const idempotencyKey = operation.idempotencyKey;
    const payment = await this.deps.client.createPayment({
      amountMinor,
      idempotencyKey,
      description: "ИИ Тоня: пилотный платёж",
      returnUrl: this.deps.returnUrl,
      metadata: { purpose: PAYMENTS_PILOT_PURPOSE },
      receipt: {
        customer: { email: input.email },
        item: { description: "Пилотный платёж ИИ Тоня", ...this.deps.receipt },
      },
    });
    if (
      payment.metadata?.purpose !== PAYMENTS_PILOT_PURPOSE ||
      payment.confirmation?.type !== "redirect"
    )
      throw new Error("payments_pilot_provider_response_invalid");
    // Without a durable record the user never sees the confirmation URL.
    await this.deps.ledger.recordCreated({
      providerPaymentId: payment.id,
      principalId: input.principalId,
      amountMinor,
      idempotencyKey,
    });
    return {
      paymentId: payment.id,
      confirmationUrl: payment.confirmation.url,
      amountMinor,
    };
  }

  /** Re-reads the provider object and stores its status; null when not a pilot payment. */
  async refresh(
    paymentId: string,
    principalId?: string,
  ): Promise<PaymentsPilotRecord | null> {
    const record = await this.deps.ledger.find(paymentId);
    if (record === null) return null;
    if (principalId !== undefined && record.principalId !== principalId)
      return null;
    const payment = await this.deps.client.getPayment(paymentId);
    if (
      payment.id !== paymentId ||
      payment.metadata?.purpose !== PAYMENTS_PILOT_PURPOSE ||
      payment.amount.value !== formatRubMinor(record.amountMinor) ||
      payment.amount.currency !== "RUB"
    )
      throw new Error("payments_pilot_provider_mismatch");
    await this.deps.ledger.recordStatus({
      providerPaymentId: paymentId,
      principalId: record.principalId,
      status: payment.status,
    });
    const current = await this.deps.ledger.find(paymentId);
    return current === null ? null : current;
  }

  /** Webhook hook: "absent" lets other handlers decide; "complete" means stored. */
  async handleNotification(
    notification: YooKassaNotification,
  ): Promise<"absent" | "complete"> {
    if (notification.event === "refund.succeeded") return "absent";
    return (await this.refresh(notification.object.id)) === null
      ? "absent"
      : "complete";
  }
}

export async function paymentsPilotRoutes(
  app: FastifyInstance,
  deps: { service: PaymentsPilotService; principals: ClientPrincipalResolver },
): Promise<void> {
  const principal = async (authorization: unknown) => {
    if (typeof authorization !== "string") return { kind: "denied" } as const;
    return resolveClientPrincipal(deps.principals, authorization);
  };
  app.post(
    "/v1/payments-pilot/checkout",
    { bodyLimit: 4 * 1024 },
    async (request, reply) => {
      const resolved = await principal(request.headers.authorization);
      if (resolved.kind !== "resolved")
        return reply
          .code(resolved.kind === "unavailable" ? 503 : 401)
          .send({ error: "unauthorized" });
      const body = request.body as { email?: unknown } | null | undefined;
      const email = body?.email;
      if (typeof email !== "string" || !EMAIL.test(email))
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const result = await deps.service.checkout({
          principalId: resolved.principal.userId,
          email,
        });
        return reply.code(201).send({
          paymentId: result.paymentId,
          confirmationUrl: result.confirmationUrl,
          amountRub: formatRubMinor(result.amountMinor),
        });
      } catch (error) {
        if (error instanceof PaymentsPilotRefusedError)
          return reply.code(403).send({ error: "forbidden" });
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    "/v1/payments-pilot/payments/:id",
    async (request, reply) => {
      const resolved = await principal(request.headers.authorization);
      if (resolved.kind !== "resolved")
        return reply
          .code(resolved.kind === "unavailable" ? 503 : 401)
          .send({ error: "unauthorized" });
      try {
        const record = await deps.service.refresh(
          request.params.id,
          resolved.principal.userId,
        );
        if (record === null)
          return reply.code(404).send({ error: "not_found" });
        return reply.send({
          paymentId: record.providerPaymentId,
          status: record.status,
          amountRub: formatRubMinor(record.amountMinor),
        });
      } catch {
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
    },
  );
}

/** Server options for the direct-shop pilot: the webhook capability is always
 * composed (YooKassa on requires it); the checkout route only with the flag. */
export function createPaymentsPilotServerOptions(
  config: RuntimeConfig,
  db: DrizzleDb,
  options: {
    env?: NodeJS.ProcessEnv;
    transport?: YooKassaTransport;
    ledger?: PaymentsPilotLedger;
  } = {},
):
  | {
      yookassaWebhook: Omit<YooKassaWebhookDependencies, "onboarding">;
      paymentsPilot: PaymentsPilotService;
    }
  | undefined {
  const pilot = config.paymentsPilot;
  if (
    pilot === undefined ||
    config.features.yookassa !== true ||
    config.yookassa === undefined ||
    config.yookassaGateway !== undefined
  )
    return undefined;
  if (config.yookassa.mode !== "live")
    throw new Error("payments_pilot_live_mode_required");
  // Resolve only the approved reference; never keep the env object.
  const secretKey = (options.env ?? process.env).YOOKASSA_SECRET_KEY;
  if (!secretKey || secretKey.length < 8 || secretKey.length > 256)
    throw new Error("payments_pilot_credentials_unavailable");
  const client = createYooKassaClient(
    {
      mode: config.yookassa.mode,
      shopId: config.yookassa.shopId,
      secretKey,
      maxPaymentAmountMinor: pilot.maxAmountMinor,
    },
    options.transport,
  );
  const service = new PaymentsPilotService({
    client,
    ledger: options.ledger ?? new PostgresPaymentsPilotLedger(db),
    pilot,
    returnUrl: config.yookassa.returnUrl,
    receipt: config.yookassa.receipt,
  });
  return {
    paymentsPilot: service,
    yookassaWebhook: {
      effectivePeerAddress,
      inbox: new PostgresWebhookInboxRepository(db),
      pilot: {
        handle: (notification) => service.handleNotification(notification),
      },
      // Only pilot payments exist in this mode; anything else stays retryable.
      verify: async () => null,
      deliver: async () => {
        throw new Error("payments_pilot_delivery_unsupported");
      },
      resolveSucceeded: async () => undefined,
    },
  };
}
