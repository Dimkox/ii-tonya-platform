import { describe, expect, it, vi } from "vitest";
import { SELARTI_ALL_MESSAGES_FIXTURE } from "../../config/src/selarti-official-response-fixture.js";
import {
  createSelartiAllMessagesBridge,
  internalSelartiProposalBody,
  type PendingSelartiRequest,
  type SelartiResponseReceipts,
} from "./selarti-all-messages-bridge.js";

const requestId = `sha256:${"a".repeat(64)}`;
const dialogueId = "00000000-0000-4000-8000-000000000501";

function memoryReceipts(): SelartiResponseReceipts & {
  markComplete(messageKey: string): void;
} {
  const complete = new Set<string>();
  return {
    markComplete(messageKey) {
      complete.add(messageKey);
    },
    async lookup(messageKey) {
      return complete.has(messageKey) ? "complete" : "absent";
    },
  };
}

function bridge(options?: {
  readonly pending?: PendingSelartiRequest;
  readonly handle?: (raw: unknown) => Promise<{ status: string }>;
  readonly taskId?: string;
}) {
  const receipts = memoryReceipts();
  const handle = vi.fn(
    async (raw: unknown, context?: { messageReceiptKey?: string }) => {
      const result = options?.handle
        ? await options.handle(raw)
        : { status: "accepted" as const };
      if (context?.messageReceiptKey && result.status !== "unavailable")
        receipts.markComplete(context.messageReceiptKey);
      return result;
    },
  );
  const findPending = vi.fn(
    async (): Promise<PendingSelartiRequest> =>
      options?.pending ?? {
        kind: "one",
        requestId,
        dialogueId,
      },
  );
  return {
    receipts,
    handle,
    findPending,
    ingress: createSelartiAllMessagesBridge({
      taskId: options?.taskId ?? SELARTI_ALL_MESSAGES_FIXTURE.task_id,
      correlation: { findPending },
      receipts,
      responses: { handle },
    }),
  };
}

describe("Selarti all_messages bridge", () => {
  it("feeds bot and operator replies through the internal proposal only", async () => {
    const bot = bridge();
    const payload = {
      ...SELARTI_ALL_MESSAGES_FIXTURE,
      future_field: { added: true },
    };
    await expect(bot.ingress.handle(payload)).resolves.toEqual({
      status: "accepted",
    });
    expect(bot.handle).toHaveBeenCalledTimes(1);
    const proposal = bot.handle.mock.calls[0]![0];
    expect(Object.keys(proposal as object).sort()).toEqual([
      "dialogueId",
      "requestId",
      "text",
      "threadId",
      "version",
    ]);
    expect(proposal).toEqual(
      internalSelartiProposalBody({
        requestId,
        dialogueId,
        text: SELARTI_ALL_MESSAGES_FIXTURE.message_text,
      }),
    );
    expect(JSON.stringify(proposal)).not.toContain(
      SELARTI_ALL_MESSAGES_FIXTURE.thread_id,
    );
    expect(JSON.stringify(proposal)).not.toContain(
      SELARTI_ALL_MESSAGES_FIXTURE.message_id,
    );
    expect(JSON.stringify(proposal)).not.toContain(
      SELARTI_ALL_MESSAGES_FIXTURE.task_id,
    );

    const operator = bridge();
    await expect(
      operator.ingress.handle({
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        message_type: "operator",
        message_id: "1731336491876x582725124419040401",
        message_text: "Оператор на связи.",
      }),
    ).resolves.toEqual({ status: "accepted" });
    expect(operator.handle.mock.calls[0]![0]).toMatchObject({
      threadId: requestId,
      text: "Оператор на связи.",
    });
  });

  it("ignores user messages and a mismatched task without calling the proposal service", async () => {
    const user = bridge();
    await expect(
      user.ingress.handle({
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        message_type: "user",
        message_text: "Привет",
      }),
    ).resolves.toEqual({ status: "ignored" });
    expect(user.handle).not.toHaveBeenCalled();
    expect(user.findPending).not.toHaveBeenCalled();

    const foreign = bridge();
    await expect(
      foreign.ingress.handle({
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        task_id: "1721129985149x000000000000000001",
      }),
    ).resolves.toEqual({ status: "ignored" });
    expect(foreign.handle).not.toHaveBeenCalled();
  });

  it("is idempotent on message_id and does not guess among two pending requests", async () => {
    const once = bridge();
    const first = await once.ingress.handle(SELARTI_ALL_MESSAGES_FIXTURE);
    const second = await once.ingress.handle({
      ...SELARTI_ALL_MESSAGES_FIXTURE,
      message_text: "Другой текст того же message_id",
    });
    expect(first).toEqual({ status: "accepted" });
    expect(second).toEqual({ status: "duplicate" });
    expect(once.handle).toHaveBeenCalledTimes(1);
    expect(once.findPending).toHaveBeenCalledTimes(1);
    once.findPending.mockResolvedValue({
      kind: "one",
      requestId: `sha256:${"b".repeat(64)}`,
      dialogueId: "00000000-0000-4000-8000-000000000502",
    });
    await once.ingress.handle(SELARTI_ALL_MESSAGES_FIXTURE);
    expect(once.handle).toHaveBeenCalledTimes(1);
    expect(once.findPending).toHaveBeenCalledTimes(1);

    let pending: PendingSelartiRequest = { kind: "ambiguous" };
    const ambiguous = bridge();
    ambiguous.findPending.mockImplementation(async () => pending);
    await expect(
      ambiguous.ingress.handle(SELARTI_ALL_MESSAGES_FIXTURE),
    ).resolves.toEqual({ status: "rejected" });
    expect(ambiguous.handle).not.toHaveBeenCalled();
    pending = { kind: "one", requestId, dialogueId };
    await expect(
      ambiguous.ingress.handle({
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        message_id: "1731336491876x582725124419040499",
      }),
    ).resolves.toEqual({ status: "accepted" });
  });

  it("keeps unknown webhook types from reaching correlation", async () => {
    const current = bridge();
    await expect(
      current.ingress.handle({
        ...SELARTI_ALL_MESSAGES_FIXTURE,
        wh_type: "interest",
      }),
    ).resolves.toEqual({ status: "ignored" });
    expect(current.findPending).not.toHaveBeenCalled();
  });
});
