import { createHash } from "node:crypto";

import {
  parseOpaqueConversationToken,
  type OpaqueConversationToken,
} from "@ii-tonya/application";

export interface RawHeaderOccurrence {
  readonly name: string;
  readonly value: string;
}

export interface AuthenticatedClientConversationInbound {
  readonly kind: "client_message";
  readonly provider: "selarti";
  readonly tenantToken: OpaqueConversationToken;
  readonly subjectToken: OpaqueConversationToken;
  readonly providerEventId: OpaqueConversationToken;
  readonly providerMessageId: OpaqueConversationToken;
  readonly occurredAt: string;
  readonly text: string;
}

export type AuthenticatedConversationInboundResult =
  | {
      readonly kind: "authenticated";
      readonly event: AuthenticatedClientConversationInbound;
    }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

export interface AuthenticatedConversationInboundCapability {
  authenticate(input: {
    readonly rawBody: Uint8Array;
    readonly rawHeaders: readonly RawHeaderOccurrence[];
    readonly signal: AbortSignal;
  }): Promise<AuthenticatedConversationInboundResult>;
}

const resultKeys = new Set(["kind", "event"]);
const terminalResultKeys = new Set(["kind"]);
const eventKeys = new Set([
  "kind",
  "provider",
  "tenantToken",
  "subjectToken",
  "providerEventId",
  "providerMessageId",
  "occurredAt",
  "text",
]);

const exactPlainRecord = (
  value: unknown,
  keys: ReadonlySet<string>,
): value is Record<string, unknown> => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    const actualKeys = Object.keys(value);
    return (
      (prototype === Object.prototype || prototype === null) &&
      actualKeys.length === keys.size &&
      actualKeys.every((key) => keys.has(key))
    );
  } catch {
    return false;
  }
};

const validOccurredAt = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
};

const validateEvent = (
  value: unknown,
): AuthenticatedClientConversationInbound | null => {
  try {
    if (
      !exactPlainRecord(value, eventKeys) ||
      value.kind !== "client_message" ||
      value.provider !== "selarti" ||
      typeof value.text !== "string" ||
      value.text.length === 0 ||
      value.text.length > 4_096 ||
      !validOccurredAt(value.occurredAt)
    ) {
      return null;
    }
    const tenantToken = parseOpaqueConversationToken(value.tenantToken);
    const subjectToken = parseOpaqueConversationToken(value.subjectToken);
    const providerEventId = parseOpaqueConversationToken(value.providerEventId);
    const providerMessageId = parseOpaqueConversationToken(
      value.providerMessageId,
    );
    if (
      tenantToken === null ||
      subjectToken === null ||
      providerEventId === null ||
      providerMessageId === null
    ) {
      return null;
    }
    return Object.freeze({
      kind: "client_message",
      provider: "selarti",
      tenantToken,
      subjectToken,
      providerEventId,
      providerMessageId,
      occurredAt: value.occurredAt,
      text: value.text,
    });
  } catch {
    return null;
  }
};

export const authenticateClientConversationInbound = async (
  capability: AuthenticatedConversationInboundCapability,
  input: {
    readonly rawBody: Uint8Array;
    readonly rawHeaders: readonly RawHeaderOccurrence[];
    readonly signal: AbortSignal;
  },
): Promise<AuthenticatedConversationInboundResult> => {
  try {
    const result: unknown = await capability.authenticate(input);
    if (!exactPlainRecord(result, terminalResultKeys)) {
      if (
        !exactPlainRecord(result, resultKeys) ||
        result.kind !== "authenticated"
      ) {
        return { kind: "denied" };
      }
      const event = validateEvent(result.event);
      return event === null
        ? { kind: "denied" }
        : { kind: "authenticated", event };
    }
    return result.kind === "denied"
      ? { kind: "denied" }
      : result.kind === "unavailable"
        ? { kind: "unavailable" }
        : { kind: "denied" };
  } catch {
    return { kind: "unavailable" };
  }
};

const lengthPrefixed = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
};

export const clientConversationPayloadDigest = (
  event: AuthenticatedClientConversationInbound,
): string =>
  createHash("sha256")
    .update("ii-tonya/client-conversation-inbound-payload/v1\0", "utf8")
    .update(lengthPrefixed(event.tenantToken))
    .update(lengthPrefixed(event.subjectToken))
    .update(lengthPrefixed(event.providerEventId))
    .update(lengthPrefixed(event.providerMessageId))
    .update(lengthPrefixed(event.occurredAt))
    .update(lengthPrefixed(event.text))
    .digest("hex");
