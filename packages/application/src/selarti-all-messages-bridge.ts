import { createHash, timingSafeEqual } from "node:crypto";

export type SelartiIngressStatus =
  | "accepted"
  | "duplicate"
  | "conflict"
  | "rejected"
  | "late"
  | "unavailable"
  | "ignored";

export interface SelartiResponseReceipts {
  claim(
    messageKey: string,
  ): Promise<
    | { readonly kind: "claimed"; readonly claimId: string }
    | { readonly kind: "duplicate" }
    | { readonly kind: "busy" }
  >;
  complete(claimId: string): Promise<void>;
  release(claimId: string): Promise<void>;
}

export type PendingSelartiRequest =
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | {
      readonly kind: "one";
      readonly requestId: string;
      readonly dialogueId: string;
    };

const visibleId = /^[^\s\u0000-\u001F\u007F]{1,256}$/u;

export function selartiMessageReceiptKey(messageId: string): string {
  return `sha256:${createHash("sha256").update(messageId).digest("hex")}`;
}

export function internalSelartiProposalBody(input: {
  readonly requestId: string;
  readonly dialogueId: string;
  readonly text: string;
}): {
  readonly version: 1;
  readonly requestId: string;
  readonly dialogueId: string;
  readonly threadId: string;
  readonly text: string;
} {
  return {
    version: 1,
    requestId: input.requestId,
    dialogueId: input.dialogueId,
    threadId: input.requestId,
    text: input.text,
  };
}

function sameSecret(actual: string, expected: string): boolean {
  const left = createHash("sha256").update(actual).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

type ParsedWebhook =
  | { readonly kind: "ignored" }
  | { readonly kind: "rejected" }
  | {
      readonly kind: "user";
    }
  | {
      readonly kind: "reply";
      readonly externalChatId: string;
      readonly messageId: string;
      readonly messageText: string;
      readonly taskId: string;
    };

function parseAllMessages(raw: unknown): ParsedWebhook {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { kind: "rejected" };
  const body = raw as Record<string, unknown>;
  if (body.wh_type !== "all_messages") return { kind: "ignored" };
  if (body.message_type === "user") return { kind: "user" };
  if (body.message_type !== "bot" && body.message_type !== "operator")
    return { kind: "ignored" };
  if (
    typeof body.external_chat_id !== "string" ||
    !visibleId.test(body.external_chat_id) ||
    typeof body.message_id !== "string" ||
    !visibleId.test(body.message_id) ||
    typeof body.task_id !== "string" ||
    !visibleId.test(body.task_id) ||
    typeof body.message_text !== "string" ||
    body.message_text.length < 1 ||
    body.message_text.length > 4_096
  )
    return { kind: "rejected" };
  return {
    kind: "reply",
    externalChatId: body.external_chat_id,
    messageId: body.message_id,
    messageText: body.message_text,
    taskId: body.task_id,
  };
}

export function createSelartiAllMessagesBridge(deps: {
  readonly taskId: string;
  readonly correlation: {
    findPending(externalChatId: string): Promise<PendingSelartiRequest>;
  };
  readonly receipts: SelartiResponseReceipts;
  readonly responses: {
    handle(raw: unknown): Promise<{ readonly status: string }>;
  };
}) {
  if (!visibleId.test(deps.taskId))
    throw new Error("selarti_response_task_unconfigured");
  return {
    async handle(
      raw: unknown,
    ): Promise<{ readonly status: SelartiIngressStatus }> {
      const parsed = parseAllMessages(raw);
      if (parsed.kind === "user" || parsed.kind === "ignored")
        return { status: "ignored" };
      if (parsed.kind === "rejected") return { status: "rejected" };
      if (!sameSecret(parsed.taskId, deps.taskId)) return { status: "ignored" };
      const key = selartiMessageReceiptKey(parsed.messageId);
      let claim: Awaited<ReturnType<SelartiResponseReceipts["claim"]>>;
      try {
        claim = await deps.receipts.claim(key);
      } catch {
        return { status: "unavailable" };
      }
      if (claim.kind === "duplicate") return { status: "duplicate" };
      if (claim.kind === "busy") return { status: "unavailable" };
      const claimId = claim.claimId;
      try {
        const pending = await deps.correlation.findPending(
          parsed.externalChatId,
        );
        if (pending.kind !== "one") {
          await deps.receipts.release(claimId);
          return {
            status: pending.kind === "ambiguous" ? "rejected" : "ignored",
          };
        }
        const result = await deps.responses.handle(
          internalSelartiProposalBody({
            requestId: pending.requestId,
            dialogueId: pending.dialogueId,
            text: parsed.messageText,
          }),
        );
        if (
          result.status !== "accepted" &&
          result.status !== "duplicate" &&
          result.status !== "conflict" &&
          result.status !== "rejected" &&
          result.status !== "late" &&
          result.status !== "unavailable"
        ) {
          await deps.receipts.release(claimId);
          return { status: "unavailable" };
        }
        if (result.status === "unavailable") {
          await deps.receipts.release(claimId);
          return { status: "unavailable" };
        }
        await deps.receipts.complete(claimId);
        return { status: result.status };
      } catch {
        await deps.receipts.release(claimId).catch(() => undefined);
        return { status: "unavailable" };
      }
    },
  };
}
