import { createAuthenticatedSelartiClient } from "@ii-tonya/integrations";
import {
  internalSelartiProposalBody,
  selartiMessageReceiptKey,
  type SelartiResponseReceipts,
} from "@ii-tonya/application";

export type SelartiPollResult = {
  readonly examined: number;
  readonly ingested: number;
  readonly skipped: number;
};

type BoundRequest = {
  readonly requestId: string;
  readonly dialogueId: string;
  readonly threadId: string;
};

type PolledMessage = {
  readonly id: string;
  readonly text: string;
  readonly messageType: string;
  readonly taskId: string;
  readonly companyId: string;
};

export async function pollSelartiPendingResponses(deps: {
  readonly enabled: boolean;
  readonly taskId: string;
  readonly companyId: string;
  readonly listPending: (limit: number) => Promise<readonly BoundRequest[]>;
  readonly readMessages: (query: {
    readonly threadId: string;
    readonly limit: number;
    readonly offset: number;
  }) => Promise<
    | { readonly kind: "page"; readonly messages: readonly PolledMessage[] }
    | { readonly kind: "error" }
  >;
  readonly responses: {
    handle(raw: unknown): Promise<{ readonly status: string }>;
  };
  readonly receipts: SelartiResponseReceipts;
  readonly limit?: number;
}): Promise<SelartiPollResult> {
  if (!deps.enabled) return { examined: 0, ingested: 0, skipped: 0 };
  const limit =
    deps.limit !== undefined &&
    Number.isInteger(deps.limit) &&
    deps.limit >= 1 &&
    deps.limit <= 20
      ? deps.limit
      : 20;
  let pending: readonly BoundRequest[];
  try {
    pending = await deps.listPending(limit);
  } catch {
    return { examined: 0, ingested: 0, skipped: 1 };
  }
  let ingested = 0;
  let skipped = 0;
  for (const request of pending) {
    let page: Awaited<ReturnType<typeof deps.readMessages>>;
    try {
      page = await deps.readMessages({
        threadId: request.threadId,
        limit: 20,
        offset: 0,
      });
    } catch {
      skipped += 1;
      continue;
    }
    if (page.kind !== "page") {
      skipped += 1;
      continue;
    }
    const replies = page.messages.filter(
      (message) =>
        (message.messageType === "bot" || message.messageType === "operator") &&
        message.taskId === deps.taskId &&
        message.companyId === deps.companyId &&
        message.text.length > 0,
    );
    const claimed: { claimId: string; text: string }[] = [];
    let busy = false;
    for (const message of replies) {
      let claim: Awaited<ReturnType<SelartiResponseReceipts["claim"]>>;
      try {
        claim = await deps.receipts.claim(selartiMessageReceiptKey(message.id));
      } catch {
        busy = true;
        break;
      }
      if (claim.kind === "busy") {
        busy = true;
        break;
      }
      if (claim.kind === "claimed")
        claimed.push({ claimId: claim.claimId, text: message.text });
    }
    if (busy || claimed.length !== 1) {
      await Promise.all(
        claimed.map((item) => deps.receipts.release(item.claimId)),
      );
      if (busy || claimed.length > 1) skipped += 1;
      continue;
    }
    const only = claimed[0]!;
    try {
      const result = await deps.responses.handle(
        internalSelartiProposalBody({
          requestId: request.requestId,
          dialogueId: request.dialogueId,
          text: only.text,
        }),
      );
      if (result.status === "unavailable") {
        await deps.receipts.release(only.claimId);
        skipped += 1;
        continue;
      }
      await deps.receipts.complete(only.claimId);
      if (result.status === "accepted" || result.status === "duplicate")
        ingested += 1;
    } catch {
      await deps.receipts.release(only.claimId).catch(() => undefined);
      skipped += 1;
    }
  }
  return { examined: pending.length, ingested, skipped };
}

export function createSelartiResponsePollRunner(deps: {
  readonly apiKey: string;
  readonly companyId: string;
  readonly taskId: string;
  readonly aiId: string;
  readonly listPending: (limit: number) => Promise<readonly BoundRequest[]>;
  readonly responses: {
    handle(raw: unknown): Promise<{ readonly status: string }>;
  };
  readonly receipts: SelartiResponseReceipts;
  readonly acquire?: typeof createAuthenticatedSelartiClient;
}): () => Promise<SelartiPollResult> {
  const acquire = deps.acquire ?? createAuthenticatedSelartiClient;
  return async () => {
    let acquired: Awaited<ReturnType<typeof createAuthenticatedSelartiClient>>;
    try {
      acquired = await acquire({
        apiKey: deps.apiKey,
        companyId: deps.companyId,
        taskId: deps.taskId,
        aiId: deps.aiId,
      });
    } catch {
      return { examined: 0, ingested: 0, skipped: 1 };
    }
    if (acquired.kind !== "ready")
      return { examined: 0, ingested: 0, skipped: 1 };
    return pollSelartiPendingResponses({
      enabled: true,
      taskId: deps.taskId,
      companyId: deps.companyId,
      listPending: deps.listPending,
      readMessages: (query) => acquired.client.getMessages(query),
      responses: deps.responses,
      receipts: deps.receipts,
    });
  };
}
