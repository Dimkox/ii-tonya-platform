import { createHash } from "node:crypto";
import { z } from "zod";
import {
  isValidWebhookBodyLimit,
  type WebhookVerification,
} from "../http/webhook-auth.js";
import { TransportFailure } from "../http/transport-failure.js";
import type {
  CanonicalSelartiEvent,
  SelartiPort,
  SelartiSendOutcome,
} from "./selarti-port.js";

const allMessagesSchema = z
  .object({
    wh_type: z.literal("all_messages"),
    channel_id: z.string().min(1),
    company_id: z.string().min(1),
    external_chat_id: z.string().min(1),
    message_id: z.string().min(1),
    message_text: z.string(),
    message_type: z.literal("client"),
    task_id: z.string().min(1),
    thread_id: z.string().min(1),
    occurred_at: z.iso.datetime(),
  })
  .strict();

const successfulSendSchema = z
  .object({
    operation_id: z.string().min(1),
  })
  .strict();

const unconfirmedDeliverySchema = z
  .object({
    billing_mode: z.literal("disabled"),
  })
  .strict();

export interface SelartiTransportRequest {
  idempotencyKey: string;
  channelUserId: string;
  text: string;
}

export interface SelartiTransportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface SelartiTransport {
  request(command: SelartiTransportRequest): Promise<SelartiTransportResponse>;
}

export interface SelartiContractAdapterDeps {
  transport: SelartiTransport;
  authenticate(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): WebhookVerification;
  maxBodyBytes: number;
  rateLimitResponsePolicy?: "confirmed_not_applied";
}

const retryAfterMilliseconds = (
  value: string | undefined,
): number | undefined => {
  if (value === undefined || !/^\d+(?:\.\d+)?$/u.test(value)) return undefined;
  const milliseconds = Number(value) * 1_000;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  return Math.min(milliseconds, 60_000);
};

const responseHeader = (
  headers: Readonly<Record<string, string>>,
  expectedName: string,
): string | undefined => {
  const matches = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === expectedName,
  );
  return matches.length === 1 ? matches[0]![1] : undefined;
};

const providerEventIdentity = (
  companyId: string,
  messageId: string,
): string => {
  const canonicalTuple = JSON.stringify([companyId, messageId]);
  return `selarti:${createHash("sha256").update(canonicalTuple).digest("hex")}`;
};

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export class SelartiContractAdapter implements SelartiPort {
  private readonly deps: SelartiContractAdapterDeps;

  constructor(deps: SelartiContractAdapterDeps) {
    if (!isValidWebhookBodyLimit(deps.maxBodyBytes)) {
      throw new Error("invalid_max_body_bytes");
    }
    this.deps = deps;
  }

  async decodeVerifiedWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<CanonicalSelartiEvent> {
    if (rawBody.byteLength > this.deps.maxBodyBytes) {
      throw new Error("body_size");
    }

    const verification = this.deps.authenticate(rawBody, headers);
    if (!verification.accepted) {
      throw new Error("webhook_auth_rejected");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(utf8Decoder.decode(rawBody));
    } catch {
      throw new Error("invalid_schema");
    }

    if (unconfirmedDeliverySchema.safeParse(parsed).success) {
      throw new Error("outbound_delivery_contract_unconfirmed");
    }

    const message = allMessagesSchema.safeParse(parsed);
    if (!message.success) {
      throw new Error("invalid_schema");
    }

    return {
      kind: "inbound_message",
      providerEventId: providerEventIdentity(
        message.data.company_id,
        message.data.message_id,
      ),
      providerMessageId: message.data.message_id,
      channelUserId: message.data.external_chat_id,
      occurredAt: message.data.occurred_at,
      text: message.data.message_text,
    };
  }

  async sendMessage(command: {
    idempotencyKey: string;
    channelUserId: string;
    text: string;
  }): Promise<SelartiSendOutcome> {
    let response: SelartiTransportResponse;
    try {
      response = await this.deps.transport.request(command);
    } catch (error) {
      if (error instanceof TransportFailure && error.phase === "before_write") {
        return {
          kind: "not_applied",
          retryable: true,
          reasonCode: "timeout_before_write",
        };
      }
      if (error instanceof TransportFailure && error.phase === "after_write") {
        return {
          kind: "unknown_outcome",
          reconciliationKey: command.idempotencyKey,
          reasonCode: "timeout_after_write",
        };
      }
      return {
        kind: "unknown_outcome",
        reconciliationKey: command.idempotencyKey,
        reasonCode: "transport_failure_unknown_phase",
      };
    }

    if (response.status === 200) {
      const parsed =
        responseHeader(response.headers, "content-type") === "application/json"
          ? successfulSendSchema.safeParse(response.body)
          : { success: false as const };
      return parsed.success
        ? { kind: "applied", providerOperationId: parsed.data.operation_id }
        : {
            kind: "unknown_outcome",
            reconciliationKey: command.idempotencyKey,
            reasonCode: "malformed_success_response",
          };
    }

    if (
      response.status === 429 &&
      this.deps.rateLimitResponsePolicy === "confirmed_not_applied"
    ) {
      const retryAfterMs = retryAfterMilliseconds(
        responseHeader(response.headers, "retry-after"),
      );
      return {
        kind: "not_applied",
        retryable: true,
        reasonCode: "rate_limited",
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      };
    }

    return {
      kind: "unknown_outcome",
      reconciliationKey: command.idempotencyKey,
      reasonCode: Number.isSafeInteger(response.status)
        ? `http_${response.status}`
        : "invalid_transport_response",
    };
  }
}
