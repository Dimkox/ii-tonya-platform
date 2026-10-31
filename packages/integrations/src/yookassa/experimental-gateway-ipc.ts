import { z } from "zod";
import {
  yooKassaPaymentSchema,
  yooKassaRefundSchema,
  type YooKassaPayment,
  type YooKassaRefund,
} from "./contracts.js";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createConnection } from "node:net";

/** Experimental only: Node cannot authenticate the server's peer credentials here.
 * A matching abstract socket name is not proof of a fenced gateway. */
export function gatewayUserToken(key: Uint8Array, userId: string): string {
  if (
    key.length < 32 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  )
    throw new Error("invalid gateway identity");
  const uuid = Buffer.from(userId.replaceAll("-", ""), "hex");
  return createHmac("sha256", key)
    .update(Buffer.from("ii-tonya-gateway-user-v1\0", "utf8"))
    .update(uuid)
    .digest("hex");
}

export function gatewayContactToken(
  key: Uint8Array,
  contactId: string,
): string {
  if (
    key.length < 32 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      contactId,
    )
  )
    throw new Error("invalid gateway identity");
  return createHmac("sha256", key)
    .update(Buffer.from("ii-tonya-gateway-contact-v1\0", "utf8"))
    .update(Buffer.from(contactId.replaceAll("-", ""), "hex"))
    .digest("hex");
}

export function gatewayPublicOperationToken(
  key: Uint8Array,
  requestId: string,
): string {
  if (key.length < 32 || !z.uuid().safeParse(requestId).success)
    throw new Error("invalid gateway identity");
  return createHmac("sha256", key)
    .update(Buffer.from("ii-tonya-gateway-public-operation-v1\0", "utf8"))
    .update(Buffer.from(requestId.replaceAll("-", ""), "hex"))
    .digest("hex");
}

export class ExperimentalGatewayIpc {
  private readonly key: Buffer;
  private readonly authKey: Buffer;
  private readonly address: string;
  private readonly timeoutMs: number;

  constructor(options: {
    address: string;
    key: Uint8Array;
    authKey: Uint8Array;
    timeoutMs: number;
  }) {
    if (
      !options.address.startsWith("\0") ||
      options.address.length < 2 ||
      options.key.length < 32 ||
      options.authKey.length < 32 ||
      Buffer.from(options.key).equals(Buffer.from(options.authKey)) ||
      !Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 10_000
    )
      throw new Error("invalid gateway configuration");
    this.address = options.address;
    this.key = Buffer.from(options.key);
    this.authKey = Buffer.from(options.authKey);
    this.timeoutMs = options.timeoutMs;
  }

  async revokeUser(userId: string): Promise<void> {
    const outcome = await this.authenticatedRequest({
      op: "revoke_user",
      subject: gatewayUserToken(this.key, userId),
    });
    if (outcome !== "erased")
      throw new Error("gateway acknowledgement unavailable");
  }
  contactToken(contactId: string): string {
    return gatewayContactToken(this.key, contactId);
  }
  async revokeContact(contactId: string): Promise<void> {
    return this.revokeContactToken(this.contactToken(contactId), contactId);
  }
  async revokeContactToken(token: string, contactId?: string): Promise<void> {
    if (
      !/^[a-f0-9]{64}$/u.test(token) ||
      (contactId !== undefined && this.contactToken(contactId) !== token)
    )
      throw new Error("invalid gateway identity");
    const outcome = await this.authenticatedRequest({
      op: "revoke_contact",
      subject: token,
      ...(contactId === undefined ? {} : { contact_id: contactId }),
    });
    if (outcome !== "erased")
      throw new Error("gateway acknowledgement unavailable");
  }
  async barrier(): Promise<void> {
    const outcome = await this.authenticatedRequest({ op: "barrier" });
    if (outcome !== "ready")
      throw new Error("gateway acknowledgement unavailable");
  }
  async stopAll(): Promise<void> {
    const outcome = await this.authenticatedRequest({ op: "stop_all" });
    if (outcome !== "stopped")
      throw new Error("gateway acknowledgement unavailable");
  }
  /** No retry: a missing acknowledgement can mean the network write began. */
  async dispatch(
    contactId: string,
    attempt: string,
    request: Uint8Array,
    context?: {
      userId: string;
      intentId: string;
      contactId: string;
      idempotencyKey: string;
    },
  ): Promise<
    | { kind: "unknown" | "cancelled" }
    | {
        kind: "response";
        paymentId: string;
        paymentStatus: string;
        confirmationUrl?: string;
      }
  > {
    if (
      !/^[a-f0-9]{64}$/u.test(attempt) ||
      !(request instanceof Uint8Array) ||
      request.length === 0 ||
      request.length > 65536
    )
      return { kind: "unknown" };
    let subject: string;
    try {
      subject = gatewayContactToken(this.key, contactId);
    } catch {
      return { kind: "unknown" };
    }
    if (context) {
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
      if (
        ![
          context.userId,
          context.intentId,
          context.contactId,
          context.idempotencyKey,
        ].every((value) => uuid.test(value)) ||
        context.contactId !== contactId ||
        createHash("sha256")
          .update(
            Buffer.from(context.idempotencyKey.replaceAll("-", ""), "hex"),
          )
          .digest("hex") !== attempt
      )
        return { kind: "unknown" };
    }
    const body = {
      op: "dispatch",
      subject,
      attempt,
      request: Buffer.from(request).toString("base64"),
      ...(context === undefined
        ? {}
        : {
            user_id: context.userId,
            intent_id: context.intentId,
            contact_id: context.contactId,
            idempotency_key: context.idempotencyKey,
          }),
    };
    try {
      const outcome = await this.authenticatedRequest(body);
      if (outcome === "cancelled") return { kind: "cancelled" };
      if (!outcome.startsWith("response:")) return { kind: "unknown" };
      const encoded = outcome.slice(9);
      if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return { kind: "unknown" };
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) return { kind: "unknown" };
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        ![
          "confirmation_url,payment_id,payment_status",
          "payment_id,payment_status",
        ].includes(Object.keys(parsed).sort().join(","))
      )
        return { kind: "unknown" };
      const data = parsed as Record<string, unknown>;
      if (
        typeof data.payment_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(data.payment_id) ||
        typeof data.payment_status !== "string" ||
        !["pending", "waiting_for_capture", "succeeded", "canceled"].includes(
          data.payment_status,
        ) ||
        (data.confirmation_url !== undefined &&
          typeof data.confirmation_url !== "string")
      )
        return { kind: "unknown" };
      if (data.confirmation_url === undefined)
        return {
          kind: "response",
          paymentId: data.payment_id,
          paymentStatus: data.payment_status,
        };
      if (typeof data.confirmation_url !== "string") return { kind: "unknown" };
      const url = new URL(data.confirmation_url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
          url.hostname,
        )
      )
        return { kind: "unknown" };
      return {
        kind: "response",
        paymentId: data.payment_id,
        paymentStatus: data.payment_status,
        confirmationUrl: data.confirmation_url,
      };
    } catch {
      return { kind: "unknown" };
    }
  }

  /** Typed public packet carries exact JSON body only. Path and amount authority stay in PG/gateway. */
  async dispatchPublic(
    snapshot: import("./public-expert-gateway-contracts.js").PublicExpertPaymentSnapshot,
    exactBody: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PublicGatewayDispatchResult> {
    try {
      const { publicExpertPaymentSnapshotSchema } =
        await import("./public-expert-gateway-contracts.js");
      const row = publicExpertPaymentSnapshotSchema.parse(snapshot);
      if (
        row.state !== "admitted" ||
        !(exactBody instanceof Uint8Array) ||
        exactBody.length < 1 ||
        exactBody.length > 49152 ||
        `sha256:${createHash("sha256").update(exactBody).digest("hex")}` !==
          row.requestDigest
      )
        return { kind: "unknown" };
      const free =
        row.kind === "onboarding_capture" || row.kind === "onboarding_cancel";
      const outcome = await this.authenticatedRequest(
        {
          op: "public_dispatch",
          request_id: row.requestId,
          user_id: row.userId,
          idempotency_key: row.idempotencyKey,
          kind: row.kind,
          contact_id: row.contactId,
          subject:
            row.contactId === null
              ? null
              : gatewayContactToken(this.key, row.contactId),
          ...(free
            ? {
                operation_token: gatewayPublicOperationToken(
                  this.key,
                  row.requestId,
                ),
              }
            : {}),
          attempt: createHash("sha256")
            .update(Buffer.from(row.idempotencyKey.replaceAll("-", ""), "hex"))
            .digest("hex"),
          request: Buffer.from(exactBody).toString("base64"),
        },
        signal,
      );
      if (outcome === "cancelled") return { kind: "cancelled" };
      if (!outcome.startsWith("response:")) return { kind: "unknown" };
      const encoded = outcome.slice(9),
        bytes = Buffer.from(encoded, "base64url");
      if (
        !/^[A-Za-z0-9_-]{1,10000}$/u.test(encoded) ||
        bytes.toString("base64url") !== encoded
      )
        return { kind: "unknown" };
      const parsed = z
        .strictObject({
          payment_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
          payment_status: z.enum([
            "pending",
            "waiting_for_capture",
            "succeeded",
            "canceled",
          ]),
          confirmation_url: z.url().max(2048).optional(),
        })
        .parse(JSON.parse(bytes.toString("utf8")));
      if (
        (row.parentPaymentId !== null &&
          row.kind !== "main_refund" &&
          parsed.payment_id !== row.parentPaymentId) ||
        (row.kind === "main_refund" &&
          (parsed.payment_status === "waiting_for_capture" ||
            parsed.confirmation_url !== undefined))
      )
        return { kind: "unknown" };
      if (parsed.confirmation_url !== undefined) {
        const url = new URL(parsed.confirmation_url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          url.hash ||
          !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
            url.hostname,
          )
        )
          return { kind: "unknown" };
      }
      return {
        kind: "response",
        providerObjectId: parsed.payment_id,
        status: parsed.payment_status,
        ...(parsed.confirmation_url === undefined
          ? {}
          : { confirmationUrl: parsed.confirmation_url }),
      };
    } catch {
      return { kind: "unknown" };
    }
  }

  async listPublicPage(
    resource: "payments" | "refunds",
    input: {
      createdFrom: string;
      createdTo: string;
      limit: number;
      cursor?: string;
    },
    signal?: AbortSignal,
  ): Promise<{
    items: readonly (YooKassaPayment | YooKassaRefund)[];
    nextCursor?: string;
  }> {
    const from = Date.parse(input.createdFrom),
      to = Date.parse(input.createdTo);
    if (
      ![from, to].every(Number.isFinite) ||
      to <= from ||
      to - from > 31 * 86400000 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.cursor !== undefined &&
        !/^[\x21-\x7e]{1,512}$/u.test(input.cursor))
    )
      throw new Error("gateway_provider_read_invalid");
    const raw = await this.readProvider(
      {
        op:
          resource === "payments"
            ? "public_list_payments"
            : "public_list_refunds",
        created_from: input.createdFrom,
        created_to: input.createdTo,
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
      signal,
    );
    const page = z
      .strictObject({
        items: z
          .array(
            resource === "payments"
              ? yooKassaPaymentSchema
              : yooKassaRefundSchema,
          )
          .max(input.limit),
        next_cursor: z
          .string()
          .regex(/^[\x21-\x7e]{1,512}$/u)
          .optional(),
      })
      .parse(raw);
    return {
      items: page.items,
      ...(page.next_cursor === undefined
        ? {}
        : { nextCursor: page.next_cursor }),
    };
  }

  private async readProvider(
    command: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const outcome = await this.authenticatedRequest(command, signal);
    if (!outcome.startsWith("response:"))
      throw new Error("gateway_provider_read_unavailable");
    const encoded = outcome.slice(9);
    if (!/^[A-Za-z0-9_-]{1,90000}$/u.test(encoded))
      throw new Error("gateway_provider_read_invalid");
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded || bytes.length > 65536)
      throw new Error("gateway_provider_read_invalid");
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error("gateway_provider_read_invalid");
    }
  }
  async getPayment(id: string, signal?: AbortSignal): Promise<YooKassaPayment> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id))
      throw new Error("gateway_provider_read_invalid");
    const result = yooKassaPaymentSchema.safeParse(
      await this.readProvider(
        { op: "inspect_payment", payment_id: id },
        signal,
      ),
    );
    if (!result.success || result.data.id !== id)
      throw new Error("gateway_provider_read_invalid");
    return result.data;
  }
  async getRefund(id: string, signal?: AbortSignal): Promise<YooKassaRefund> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(id))
      throw new Error("gateway_provider_read_invalid");
    const result = yooKassaRefundSchema.safeParse(
      await this.readProvider({ op: "inspect_refund", refund_id: id }, signal),
    );
    if (!result.success || result.data.id !== id)
      throw new Error("gateway_provider_read_invalid");
    return result.data;
  }
  async listPayments(input: {
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
  }> {
    const from = Date.parse(input.createdFrom),
      to = Date.parse(input.createdTo);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > 31 * 86400000 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      (input.cursor !== undefined &&
        !/^[\x21-\x7e]{1,512}$/u.test(input.cursor))
    )
      throw new Error("gateway_provider_read_invalid");
    const raw = await this.readProvider({
      op: "list_payments",
      created_from: input.createdFrom,
      created_to: input.createdTo,
      limit: input.limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });
    const page = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
              created_at: z.iso.datetime({ offset: true }),
              test: z.boolean(),
              metadata: z.object({
                operation_id: z.string().optional(),
                order_id: z.string().optional(),
              }),
            }),
          )
          .max(100),
        next_cursor: z
          .string()
          .regex(/^[\x21-\x7e]{1,512}$/u)
          .optional(),
      })
      .strict()
      .safeParse(raw);
    if (!page.success || page.data.items.length > input.limit)
      throw new Error("gateway_provider_read_invalid");
    return {
      items: page.data.items.map((item) => ({
        id: item.id,
        createdAt: item.created_at,
        test: item.test,
        metadata: {
          ...(item.metadata.operation_id === undefined
            ? {}
            : { operation_id: item.metadata.operation_id }),
          ...(item.metadata.order_id === undefined
            ? {}
            : { order_id: item.metadata.order_id }),
        },
      })),
      ...(page.data.next_cursor === undefined
        ? {}
        : { nextCursor: page.data.next_cursor }),
    };
  }

  private authenticatedRequest(
    command: object,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted)
      return Promise.reject(new Error("gateway acknowledgement unavailable"));
    const nonce = randomBytes(32).toString("hex");
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.address);
      let settled = false,
        response = Buffer.alloc(0),
        stage: "hello" | "response" = "hello",
        challenge = "";
      const timer = setTimeout(() => finish(), this.timeoutMs);
      function finish(value?: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        socket.destroy();
        if (value === undefined)
          reject(new Error("gateway acknowledgement unavailable"));
        else resolve(value);
      }
      const abort = () => finish();
      if (signal?.aborted) return finish();
      signal?.addEventListener("abort", abort, { once: true });
      const validMac = (actual: unknown, tag: string) => {
        if (typeof actual !== "string" || !/^[a-f0-9]{64}$/u.test(actual))
          return false;
        const expected = createHmac("sha256", this.authKey)
            .update(tag)
            .digest(),
          supplied = Buffer.from(actual, "hex");
        return (
          supplied.length === expected.length &&
          timingSafeEqual(supplied, expected)
        );
      };
      socket.once("connect", () =>
        socket.write(JSON.stringify({ hello: nonce }) + "\n"),
      );
      socket.on("data", (chunk: Buffer) => {
        if (response.length + chunk.length > (stage === "hello" ? 512 : 100000))
          return finish();
        response = Buffer.concat([response, chunk]);
        const newline = response.indexOf(10);
        if (newline < 0) return;
        if (newline !== response.length - 1) return finish();
        try {
          const parsed: unknown = JSON.parse(
            response.subarray(0, newline).toString("utf8"),
          );
          response = Buffer.alloc(0);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return finish();
          const item = parsed as Record<string, unknown>;
          if (stage === "hello") {
            if (
              Object.keys(item).sort().join(",") !== "challenge,mac,nonce" ||
              item.nonce !== nonce ||
              typeof item.challenge !== "string" ||
              !/^[a-f0-9]{64}$/u.test(item.challenge) ||
              !validMac(item.mac, `hello\n${nonce}\n${item.challenge}`)
            )
              return finish();
            challenge = item.challenge;
            const body = JSON.stringify(command);
            const mac = createHmac("sha256", this.authKey)
              .update(`request\n${nonce}\n${challenge}\n${body}`)
              .digest("hex");
            stage = "response";
            socket.write(
              JSON.stringify({ nonce, challenge, body, mac }) + "\n",
            );
          } else {
            if (
              Object.keys(item).sort().join(",") !==
                "challenge,mac,nonce,outcome" ||
              item.nonce !== nonce ||
              item.challenge !== challenge ||
              typeof item.outcome !== "string" ||
              !validMac(
                item.mac,
                `response\n${nonce}\n${challenge}\n${item.outcome}`,
              )
            )
              return finish();
            finish(item.outcome);
          }
        } catch {
          finish();
        }
      });
      socket.once("end", () => finish());
      socket.once("error", () => finish());
      socket.once("close", () => finish());
    });
  }
}

export type PublicGatewayDispatchResult =
  | { kind: "unknown" | "cancelled" }
  | {
      kind: "response";
      providerObjectId: string;
      status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
      confirmationUrl?: string;
    };
