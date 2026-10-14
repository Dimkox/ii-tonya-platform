import { isUint8Array } from "node:util/types";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import {
  yooKassaPaymentSchema,
  yooKassaRefundSchema,
  type YooKassaMode,
  type YooKassaPayment,
  type YooKassaReceiptInput,
  type YooKassaRefund,
} from "./contracts.js";

const ORIGIN = "https://api.yookassa.ru";
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const IDEMPOTENCY_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface YooKassaTransport {
  /** Must honor init.signal during connection, headers and body consumption. */
  (url: string, init: RequestInit): Promise<Response>;
}

export interface YooKassaClientConfig {
  readonly mode: YooKassaMode;
  readonly shopId: string;
  readonly secretKey: string;
}

export interface CreateYooKassaPayment {
  readonly amountMinor: bigint;
  readonly idempotencyKey: string;
  readonly description: string;
  readonly returnUrl: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly receipt: YooKassaReceiptInput;
}

export interface CreateYooKassaPaymentOptions {
  /** Combined with the client's 15-second ceiling; never serialized to YooKassa.
   * Cancellation reports an unknown outcome, not proof that no payment exists.
   * It does not authorize resending with another idempotency key. */
  readonly signal?: AbortSignal;
}

export interface CreateYooKassaRefund {
  readonly paymentId: string;
  readonly amountMinor: bigint;
  readonly idempotencyKey: string;
  readonly description: string;
  readonly receipt: YooKassaReceiptInput;
}

export interface YooKassaClient {
  createPayment(
    command: CreateYooKassaPayment,
    options?: CreateYooKassaPaymentOptions,
  ): Promise<YooKassaPayment>;
  getPayment(paymentId: string): Promise<YooKassaPayment>;
  createRefund(command: CreateYooKassaRefund): Promise<YooKassaRefund>;
  getRefund(refundId: string): Promise<YooKassaRefund>;
}

export class YooKassaUnknownOutcomeError extends Error {
  readonly code = "yookassa_unknown_outcome";
  constructor() {
    super("yookassa_unknown_outcome");
    this.name = "YooKassaUnknownOutcomeError";
  }
}

export class YooKassaTerminalError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "YooKassaTerminalError";
  }
}

export const formatRubMinor = (value: bigint): string => {
  if (value <= 0n || value > 999_999_999_999n) {
    throw new YooKassaTerminalError("yookassa_amount_invalid");
  }
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
};

const assertProviderId = (value: string): string => {
  if (!PROVIDER_ID.test(value)) {
    throw new YooKassaTerminalError("yookassa_provider_id_invalid");
  }
  return value;
};

const assertIdempotencyKey = (value: string): string => {
  if (value.length > 64 || !IDEMPOTENCY_KEY.test(value)) {
    throw new YooKassaTerminalError("yookassa_idempotency_key_invalid");
  }
  return value;
};

// A response stream's cancel hook may itself reject or never settle. Initiate
// cleanup without letting it delay the bounded request or expose private errors.
const discardBody = (response: Response): void => {
  void response.body?.cancel().catch(() => {});
};

const readJson = async (
  response: Response,
  signal: AbortSignal,
): Promise<unknown> => {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    discardBody(response);
    throw new YooKassaTerminalError("yookassa_response_invalid");
  }
  if (!response.body) {
    throw new YooKassaTerminalError("yookassa_response_invalid");
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    throw new YooKassaUnknownOutcomeError();
  }
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const storage = new Uint8Array(MAX_RESPONSE_BYTES);
  let bytes = 0;
  let reads = 0;
  try {
    while (true) {
      if (signal.aborted) throw new YooKassaUnknownOutcomeError();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        // Stream errors are untrusted, including errors imitating our classes.
        throw new YooKassaUnknownOutcomeError();
      }
      if (signal.aborted) throw new YooKassaUnknownOutcomeError();
      if (chunk.done) break;
      if (!isUint8Array(chunk.value)) {
        throw new YooKassaUnknownOutcomeError();
      }
      if (bytes + chunk.value.byteLength > MAX_RESPONSE_BYTES) {
        throw new YooKassaTerminalError("yookassa_response_invalid");
      }
      // Own the consumed bytes: transports can reuse mutable backing buffers.
      storage.set(chunk.value, bytes);
      bytes += chunk.value.byteLength;
      // Empty or tiny synchronous chunks must not starve timers/cancellation.
      if (++reads % 64 === 0) await yieldEventLoop();
    }
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  try {
    // TextDecoder preserves Response.text's UTF-8/BOM behavior across chunks.
    return JSON.parse(
      new TextDecoder().decode(storage.subarray(0, bytes)),
    ) as unknown;
  } catch {
    throw new YooKassaTerminalError("yookassa_response_invalid");
  }
};

const receiptBody = (receipt: YooKassaReceiptInput, amount: string) => {
  if (
    (receipt.customer.email === undefined) ===
    (receipt.customer.phone === undefined)
  ) {
    throw new YooKassaTerminalError("yookassa_receipt_contact_invalid");
  }
  return {
    customer: receipt.customer,
    items: [
      {
        description: receipt.item.description,
        quantity: "1.00",
        amount: { value: amount, currency: "RUB" },
        vat_code: receipt.item.vatCode,
        payment_subject: receipt.item.paymentSubject,
        payment_mode: receipt.item.paymentMode,
      },
    ],
  };
};

export const serializeYooKassaPaymentRequest = (
  command: CreateYooKassaPayment,
): string => {
  const amount = formatRubMinor(command.amountMinor);
  return JSON.stringify({
    amount: { value: amount, currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: command.returnUrl },
    description: command.description,
    metadata: command.metadata,
    receipt: receiptBody(command.receipt, amount),
  });
};

export const serializeYooKassaRefundRequest = (
  command: CreateYooKassaRefund,
): string => {
  const amount = formatRubMinor(command.amountMinor);
  return JSON.stringify({
    payment_id: assertProviderId(command.paymentId),
    amount: { value: amount, currency: "RUB" },
    description: command.description,
    receipt: receiptBody(command.receipt, amount),
  });
};

export const createYooKassaClient = (
  config: YooKassaClientConfig,
  transport: YooKassaTransport = (url, init) => fetch(url, init),
): YooKassaClient => {
  if (!/^\d{1,32}$/u.test(config.shopId) && config.shopId !== "test-shop") {
    throw new YooKassaTerminalError("yookassa_configuration_invalid");
  }
  if (config.secretKey.length < 8 || config.secretKey.length > 256) {
    throw new YooKassaTerminalError("yookassa_configuration_invalid");
  }
  const authorization = `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`, "utf8").toString("base64")}`;

  const request = async (path: string, init: RequestInit): Promise<unknown> => {
    const ceiling = AbortSignal.timeout(15_000);
    const signal = init.signal
      ? AbortSignal.any([init.signal, ceiling])
      : ceiling;
    let response: Response;
    try {
      if (signal.aborted) throw new YooKassaUnknownOutcomeError();
      response = await transport(`${ORIGIN}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...init.headers,
        },
        signal,
      });
    } catch {
      throw new YooKassaUnknownOutcomeError();
    }
    if (signal.aborted) {
      discardBody(response);
      throw new YooKassaUnknownOutcomeError();
    }
    if (response.status === 429 || response.status >= 500) {
      discardBody(response);
      throw new YooKassaUnknownOutcomeError();
    }
    if (!response.ok) {
      discardBody(response);
      throw new YooKassaTerminalError(`yookassa_http_${response.status}`);
    }
    const body = await readJson(response, signal);
    if (signal.aborted) throw new YooKassaUnknownOutcomeError();
    return body;
  };

  const parsePayment = (body: unknown): YooKassaPayment => {
    const result = yooKassaPaymentSchema.safeParse(body);
    if (!result.success)
      throw new YooKassaTerminalError("yookassa_response_invalid");
    if (result.data.test !== (config.mode === "test")) {
      throw new YooKassaTerminalError("yookassa_mode_mismatch");
    }
    return result.data;
  };

  const parseRefund = (body: unknown): YooKassaRefund => {
    const result = yooKassaRefundSchema.safeParse(body);
    if (!result.success)
      throw new YooKassaTerminalError("yookassa_response_invalid");
    return result.data;
  };

  return {
    async createPayment(command, options) {
      const amount = formatRubMinor(command.amountMinor);
      const result = parsePayment(
        await request("/v3/payments", {
          method: "POST",
          headers: {
            "Idempotence-Key": assertIdempotencyKey(command.idempotencyKey),
          },
          body: serializeYooKassaPaymentRequest(command),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
      if (result.amount.value !== amount || result.amount.currency !== "RUB") {
        throw new YooKassaTerminalError("yookassa_amount_mismatch");
      }
      return result;
    },
    async getPayment(paymentId) {
      return parsePayment(
        await request(`/v3/payments/${assertProviderId(paymentId)}`, {
          method: "GET",
        }),
      );
    },
    async createRefund(command) {
      const amount = formatRubMinor(command.amountMinor);
      const result = parseRefund(
        await request("/v3/refunds", {
          method: "POST",
          headers: {
            "Idempotence-Key": assertIdempotencyKey(command.idempotencyKey),
          },
          body: serializeYooKassaRefundRequest(command),
        }),
      );
      if (
        result.amount.value !== amount ||
        result.paymentId !== command.paymentId
      ) {
        throw new YooKassaTerminalError("yookassa_refund_binding_mismatch");
      }
      return result;
    },
    async getRefund(refundId) {
      return parseRefund(
        await request(`/v3/refunds/${assertProviderId(refundId)}`, {
          method: "GET",
        }),
      );
    },
  };
};
