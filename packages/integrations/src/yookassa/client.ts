import { isUint8Array } from "node:util/types";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import {
  yooKassaPaymentSchema,
  yooKassaPaymentListSchema,
  yooKassaRefundSchema,
  type YooKassaMode,
  type YooKassaPayment,
  type YooKassaReceiptInput,
  type YooKassaCompositeReceiptInput,
  type YooKassaRefund,
} from "./contracts.js";

const ORIGIN = "https://api.yookassa.ru";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;
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
  readonly receipt: YooKassaReceiptInput | YooKassaCompositeReceiptInput;
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

export interface YooKassaPaymentListClient {
  listPayments(input: {
    createdFrom: string;
    createdTo: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: readonly {
      id: string;
      createdAt: string;
      test: boolean;
      metadata: { operation_id?: string; order_id?: string };
    }[];
    nextCursor?: string;
  }>;
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
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<unknown> => {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
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
  const storage = new Uint8Array(maxBytes);
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
      if (bytes + chunk.value.byteLength > maxBytes) {
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

const receiptBody = (
  receipt: YooKassaReceiptInput | YooKassaCompositeReceiptInput,
  amountMinor: bigint,
) => {
  if (
    (receipt.customer.email === undefined) ===
    (receipt.customer.phone === undefined)
  ) {
    throw new YooKassaTerminalError("yookassa_receipt_contact_invalid");
  }
  let items: readonly (YooKassaReceiptInput["item"] & {
    readonly amountMinor: bigint;
  })[];
  if ("items" in receipt) {
    const source = receipt.items;
    if (
      !Array.isArray(source) ||
      source.length !== 2 ||
      "item" in receipt ||
      !Object.hasOwn(source, 0) ||
      !Object.hasOwn(source, 1)
    )
      throw new YooKassaTerminalError("yookassa_receipt_amount_invalid");
    const snapshot = [source[0], source[1]].map((item) => {
      if (!item || typeof item !== "object")
        throw new YooKassaTerminalError("yookassa_receipt_amount_invalid");
      return {
        amountMinor: item.amountMinor,
        description: item.description,
        vatCode: item.vatCode,
        paymentSubject: item.paymentSubject,
        paymentMode: item.paymentMode,
      };
    });
    if (
      snapshot.some(
        (item) =>
          typeof item.amountMinor !== "bigint" || item.amountMinor <= 0n,
      ) ||
      snapshot[0]!.amountMinor + snapshot[1]!.amountMinor !== amountMinor
    )
      throw new YooKassaTerminalError("yookassa_receipt_amount_invalid");
    if (
      snapshot.some(
        (item) =>
          typeof item.description !== "string" ||
          item.description.trim().length === 0 ||
          item.description.length > 128 ||
          !Number.isInteger(item.vatCode) ||
          item.vatCode < 1 ||
          item.vatCode > 12 ||
          typeof item.paymentSubject !== "string" ||
          item.paymentSubject.length === 0 ||
          typeof item.paymentMode !== "string" ||
          item.paymentMode.length === 0,
      )
    )
      throw new YooKassaTerminalError("yookassa_receipt_item_invalid");
    items = snapshot;
  } else {
    items = [{ ...receipt.item, amountMinor }];
  }
  return {
    customer: receipt.customer,
    items: items.map((item) => ({
      description: item.description,
      quantity: "1.00",
      amount: { value: formatRubMinor(item.amountMinor), currency: "RUB" },
      vat_code: item.vatCode,
      payment_subject: item.paymentSubject,
      payment_mode: item.paymentMode,
    })),
  };
};

export const serializeYooKassaPaymentRequest = (
  command: CreateYooKassaPayment,
): string => {
  const amountMinor = command.amountMinor;
  const amount = formatRubMinor(amountMinor);
  return JSON.stringify({
    amount: { value: amount, currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: command.returnUrl },
    description: command.description,
    metadata: command.metadata,
    receipt: receiptBody(command.receipt, amountMinor),
  });
};

export const serializeYooKassaRefundRequest = (
  command: CreateYooKassaRefund,
): string => {
  const amountMinor = command.amountMinor;
  const amount = formatRubMinor(amountMinor);
  return JSON.stringify({
    payment_id: assertProviderId(command.paymentId),
    amount: { value: amount, currency: "RUB" },
    description: command.description,
    receipt: receiptBody(command.receipt, amountMinor),
  });
};

export const createYooKassaClient = (
  config: YooKassaClientConfig,
  transport: YooKassaTransport = (url, init) => fetch(url, init),
): YooKassaClient & YooKassaPaymentListClient => {
  if (!/^\d{1,32}$/u.test(config.shopId) && config.shopId !== "test-shop") {
    throw new YooKassaTerminalError("yookassa_configuration_invalid");
  }
  if (config.secretKey.length < 8 || config.secretKey.length > 256) {
    throw new YooKassaTerminalError("yookassa_configuration_invalid");
  }
  const authorization = `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`, "utf8").toString("base64")}`;

  const request = async (
    path: string,
    init: RequestInit,
    maxBytes = MAX_RESPONSE_BYTES,
  ): Promise<unknown> => {
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
    const body = await readJson(response, signal, maxBytes);
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
      const amountMinor = command.amountMinor;
      const amount = formatRubMinor(amountMinor);
      const result = parsePayment(
        await request("/v3/payments", {
          method: "POST",
          headers: {
            "Idempotence-Key": assertIdempotencyKey(command.idempotencyKey),
          },
          body: serializeYooKassaPaymentRequest({
            amountMinor,
            idempotencyKey: command.idempotencyKey,
            description: command.description,
            returnUrl: command.returnUrl,
            metadata: command.metadata,
            receipt: command.receipt,
          }),
          ...(options?.signal === undefined ? {} : { signal: options.signal }),
        }),
      );
      if (result.amount.value !== amount || result.amount.currency !== "RUB") {
        throw new YooKassaTerminalError("yookassa_amount_mismatch");
      }
      return result;
    },
    async listPayments(input) {
      const start = Date.parse(input.createdFrom),
        end = Date.parse(input.createdTo);
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100 ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > end ||
        end - start > 31 * 24 * 60 * 60 * 1000 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(
          input.createdFrom,
        ) ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/u.test(
          input.createdTo,
        ) ||
        (input.cursor !== undefined &&
          !/^[\x21-\x7e]{1,1024}$/u.test(input.cursor))
      )
        throw new YooKassaTerminalError("yookassa_list_invalid");
      const query = new URLSearchParams({
        "created_at.gte": input.createdFrom,
        "created_at.lte": input.createdTo,
        limit: String(input.limit),
      });
      if (input.cursor !== undefined) query.set("cursor", input.cursor);
      const parsed = yooKassaPaymentListSchema.safeParse(
        await request(
          `/v3/payments?${query.toString()}`,
          { method: "GET" },
          MAX_LIST_RESPONSE_BYTES,
        ),
      );
      if (
        !parsed.success ||
        parsed.data.items.length > input.limit ||
        parsed.data.items.some(
          (item) =>
            Date.parse(item.created_at) < start ||
            Date.parse(item.created_at) > end,
        )
      )
        throw new YooKassaTerminalError("yookassa_response_invalid");
      return {
        items: parsed.data.items.map((item) => ({
          id: item.id,
          createdAt: item.created_at,
          test: item.test,
          metadata: {
            ...(typeof item.metadata?.operation_id === "string" &&
            item.metadata.operation_id.length > 0 &&
            item.metadata.operation_id.length <= 128
              ? { operation_id: item.metadata.operation_id }
              : {}),
            ...(typeof item.metadata?.order_id === "string" &&
            item.metadata.order_id.length > 0 &&
            item.metadata.order_id.length <= 128
              ? { order_id: item.metadata.order_id }
              : {}),
          },
        })),
        ...(parsed.data.next_cursor === undefined
          ? {}
          : { nextCursor: parsed.data.next_cursor }),
      };
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
