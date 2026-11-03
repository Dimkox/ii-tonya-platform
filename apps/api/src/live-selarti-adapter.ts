import {
  createAuthenticatedSelartiClient,
  createSignedWebhookVerifier,
  SelartiContractAdapter,
  type AuthenticatedSelartiClientResult,
  type CanonicalSelartiEvent,
  type SelartiPort,
  type SelartiRestFetch,
  type SelartiSendOutcome,
} from "@ii-tonya/integrations";

/**
 * Header names for the inbound HMAC check. The public Selarti collection does
 * not document inbound webhook authentication, so these are a project
 * assumption: the sender must sign `${timestamp}.${rawBody}` with HMAC-SHA256
 * (hex) using SELARTI_WEBHOOK_SECRET. See docs/runbooks/selarti-live-adapter.md.
 */
export const SELARTI_SIGNATURE_HEADER = "x-selarti-signature";
export const SELARTI_TIMESTAMP_HEADER = "x-selarti-timestamp";

export interface LiveSelartiAdapterOptions {
  apiKey: string;
  webhookSecret: string;
  companyId: string;
  taskId: string;
  aiId: string;
  fetch?: SelartiRestFetch;
  nowEpochSeconds?: () => number;
  maxAgeSeconds?: number;
  /** Test seam; defaults to the real authenticated client factory. */
  acquire?: typeof createAuthenticatedSelartiClient;
}

const header = (
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined => {
  const matches = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name,
  );
  return matches.length === 1 ? matches[0]![1] : undefined;
};

const noTransport = {
  request(): never {
    throw new Error("selarti_contract_transport_unused");
  },
};

/**
 * Live Selarti boundary. Inbound: signed `all_messages` webhook decoded by the
 * contract codec. Outbound: fresh authenticated, ownership-bound REST client
 * per send (POST auth, GET get_task/get_ai, then external send). No retries.
 */
export class LiveSelartiAdapter implements SelartiPort {
  private readonly decoder: SelartiContractAdapter;
  private readonly options: LiveSelartiAdapterOptions;

  constructor(options: LiveSelartiAdapterOptions) {
    const verify = createSignedWebhookVerifier({
      secret: options.webhookSecret,
      nowEpochSeconds:
        options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1000)),
      maxAgeSeconds: options.maxAgeSeconds ?? 300,
      maxBodyBytes: 64_000,
    });
    this.options = options;
    this.decoder = new SelartiContractAdapter({
      transport: noTransport,
      maxBodyBytes: 64_000,
      authenticate: (body, headers) =>
        verify({
          body,
          contentType: header(headers, "content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase(),
          signature: header(headers, SELARTI_SIGNATURE_HEADER),
          timestamp: header(headers, SELARTI_TIMESTAMP_HEADER),
        }),
    });
  }

  decodeVerifiedWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<CanonicalSelartiEvent> {
    return this.decoder.decodeVerifiedWebhook(rawBody, headers);
  }

  async sendMessage(command: {
    idempotencyKey: string;
    channelUserId: string;
    text: string;
  }): Promise<SelartiSendOutcome> {
    const acquire = this.options.acquire ?? createAuthenticatedSelartiClient;
    let acquired: AuthenticatedSelartiClientResult;
    try {
      acquired = await acquire({
        apiKey: this.options.apiKey,
        companyId: this.options.companyId,
        taskId: this.options.taskId,
        aiId: this.options.aiId,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
    } catch {
      acquired = { kind: "unavailable", code: "acquisition_failed" };
    }
    // Acquisition performs only auth and reads; no message was written.
    if (acquired.kind === "unavailable")
      return {
        kind: "not_applied",
        retryable: acquired.code === "acquisition_failed",
        reasonCode: `selarti_${acquired.code}`,
      };
    let outcome;
    try {
      outcome = await acquired.client.sendExternal({
        chatId: command.channelUserId,
        text: command.text,
      });
    } catch {
      return {
        kind: "unknown_outcome",
        reconciliationKey: command.idempotencyKey,
        reasonCode: "send_threw",
      };
    }
    if (outcome.kind === "accepted")
      return { kind: "applied", providerOperationId: outcome.threadId };
    if (outcome.kind === "not_applied")
      return {
        kind: "not_applied",
        retryable: outcome.code === "before_write",
        reasonCode: `selarti_${outcome.code}`,
      };
    return {
      kind: "unknown_outcome",
      reconciliationKey: command.idempotencyKey,
      reasonCode: outcome.code,
    };
  }
}
