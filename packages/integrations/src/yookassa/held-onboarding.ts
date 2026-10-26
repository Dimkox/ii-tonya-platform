import { createHash } from "node:crypto";
import { z } from "zod";
import { yooKassaPaymentSchema } from "./contracts.js";
import type { YooKassaClientConfig, YooKassaTransport } from "./client.js";
const ORIGIN = "https://api.yookassa.ru";
const amount = z
  .object({ value: z.literal("3000.00"), currency: z.literal("RUB") })
  .strict();
const create = z
  .object({
    amount,
    capture: z.literal(false),
    payment_method_data: z.object({ type: z.literal("bank_card") }).strict(),
    confirmation: z.object({
      type: z.literal("redirect"),
      return_url: z.url(),
    }),
    description: z.string().max(128).optional(),
    metadata: z
      .object({
        order_id: z.string(),
        operation_id: z.string(),
        purpose: z.literal("onboarding"),
        user_id: z.string().optional(),
      })
      .strict(),
    receipt: z
      .object({
        customer: z.object({ email: z.email() }).strict(),
        items: z
          .array(
            z.object({
              description: z.string().min(1).max(128),
              quantity: z.literal("1.00"),
              amount,
              vat_code: z.number().int().min(1).max(12),
              payment_subject: z.literal("service"),
              payment_mode: z.literal("full_payment"),
            }),
          )
          .length(1),
      })
      .strict(),
  })
  .strict();
const observed = new WeakSet<object>();
export type HeldPaymentObservation = Readonly<
  z.output<typeof yooKassaPaymentSchema> & {
    method: "bank_card";
    evidenceDigest: string;
  }
>;
export function assertHeldPaymentObservation(
  value: unknown,
): asserts value is HeldPaymentObservation {
  if (!value || typeof value !== "object" || !observed.has(value))
    throw new Error("held_payment_get_required");
}
/** Separate capability: legacy one-stage payment serialization is untouched. */
export function createHeldOnboardingClient(
  config: YooKassaClientConfig & { enabled: boolean },
  transport: YooKassaTransport = (url, init) => fetch(url, init),
) {
  if (
    !/^(?:[0-9]{1,32}|test-shop)$/u.test(config.shopId) ||
    config.secretKey.length < 8 ||
    config.secretKey.length > 256 ||
    !["test", "live"].includes(config.mode)
  )
    throw new Error("held_payment_configuration_invalid");
  const auth = `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString("base64")}`;
  const provider = (id: string) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id))
      throw new Error("held_payment_invalid");
    return id;
  };
  async function request(path: string, init: RequestInit) {
    if (!config.enabled) throw new Error("held_payment_disabled");
    let response: Response;
    const signal = AbortSignal.timeout(15000);
    try {
      response = await transport(`${ORIGIN}/v3/${path}`, {
        ...init,
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        signal,
      });
    } catch {
      throw new Error("held_payment_unknown");
    }
    if (!response.ok)
      throw new Error(
        response.status >= 500 || response.status === 429
          ? "held_payment_unknown"
          : "held_payment_rejected",
      );
    if (!response.body) throw new Error("held_payment_invalid");
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("held_payment_unknown"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    let raw: string;
    try {
      while (true) {
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 262144) throw new Error("held_payment_invalid");
        chunks.push(part.value);
      }
      raw = new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks),
      );
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message === "held_payment_invalid"
          ? "held_payment_invalid"
          : "held_payment_unknown",
      );
    } finally {
      signal.removeEventListener("abort", onAbort);
      void reader.cancel().catch(() => {});
      try {
        reader.releaseLock();
      } catch {
        /* A pending read has already been canceled. */
      }
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("held_payment_invalid");
    }
    const result = yooKassaPaymentSchema.safeParse(value);
    if (!result.success || result.data.test !== (config.mode === "test"))
      throw new Error("held_payment_invalid");
    return {
      raw: value as { payment_method?: { type?: unknown } },
      payment: result.data,
    };
  }
  return {
    async postExact(command: {
      kind: "create" | "capture" | "cancel";
      paymentId?: string;
      idempotencyKey: string;
      body: string;
    }) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          command.idempotencyKey,
        )
      )
        throw new Error("held_payment_invalid");
      let value: unknown;
      try {
        value = JSON.parse(command.body);
      } catch {
        throw new Error("held_payment_invalid");
      }
      const schema =
        command.kind === "create"
          ? create
          : command.kind === "capture"
            ? z.object({ amount }).strict()
            : z.object({}).strict();
      if (!schema.safeParse(value).success)
        throw new Error("held_payment_invalid");
      const path =
        command.kind === "create"
          ? "payments"
          : `payments/${provider(command.paymentId ?? "")}/${command.kind}`;
      const r = await request(path, {
        method: "POST",
        headers: { "Idempotence-Key": command.idempotencyKey },
        body: command.body,
      });
      if (
        (command.kind !== "create" && r.payment.id !== command.paymentId) ||
        r.payment.amount.value !== "3000.00" ||
        r.payment.amount.currency !== "RUB"
      )
        throw new Error("held_payment_invalid");
      if (command.kind === "create") {
        const expected = create.parse(value).metadata;
        if (
          r.raw.payment_method?.type !== "bank_card" ||
          Object.entries(expected).some(
            ([key, item]) => r.payment.metadata[key] !== item,
          )
        )
          throw new Error("held_payment_invalid");
      }
      return r.payment;
    },
    async inspect(paymentId: string): Promise<HeldPaymentObservation> {
      const r = await request(`payments/${provider(paymentId)}`, {
        method: "GET",
      });
      if (
        r.payment.id !== paymentId ||
        r.raw.payment_method?.type !== "bank_card" ||
        r.payment.amount.value !== "3000.00" ||
        (r.payment.status === "waiting_for_capture" && !r.payment.paid)
      )
        throw new Error("held_payment_unsupported");
      if (r.payment.confirmation) {
        const url = new URL(r.payment.confirmation.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
            url.hostname,
          )
        )
          throw new Error("held_payment_unsupported");
      }
      const result = Object.freeze({
        ...r.payment,
        method: "bank_card" as const,
        evidenceDigest: `sha256:${createHash("sha256").update(JSON.stringify(r.payment)).digest("hex")}`,
      });
      observed.add(result);
      return result;
    },
  };
}
export type HeldOnboardingClient = ReturnType<
  typeof createHeldOnboardingClient
>;
