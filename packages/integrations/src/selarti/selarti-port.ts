export interface CanonicalInboundMessage {
  kind: "inbound_message";
  providerEventId: string;
  providerMessageId: string;
  channelUserId: string;
  occurredAt: string;
  text: string;
}

export interface CanonicalOutboundDelivery {
  kind: "outbound_delivery";
  provider: "selarti";
  providerEventId: string;
  providerMessageId: string;
  occurredAt: string;
  status: "delivered";
}

export type CanonicalSelartiEvent =
  CanonicalInboundMessage | CanonicalOutboundDelivery;

export type SelartiSendOutcome =
  | { kind: "applied"; providerOperationId: string }
  | {
      kind: "not_applied";
      retryable: boolean;
      reasonCode: string;
      retryAfterMs?: number;
    }
  | { kind: "unknown_outcome"; reconciliationKey: string; reasonCode: string };

export interface SelartiPort {
  decodeVerifiedWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<CanonicalSelartiEvent>;

  sendMessage(command: {
    idempotencyKey: string;
    channelUserId: string;
    text: string;
  }): Promise<SelartiSendOutcome>;
}
