import { describe, expect, it, vi } from "vitest";
import type { SelartiResponseReceipts } from "@ii-tonya/application";
import {
  createSelartiResponsePollRunner,
  pollSelartiPendingResponses,
} from "./selarti-response-poller.js";

const requestId = `sha256:${"b".repeat(64)}`;
const dialogueId = "00000000-0000-4000-8000-000000000777";
const threadId = "1731336491572x316716105037601100";
const taskId = "1721129985149x478019552540622850";
const companyId = "1708251850060x460235863640434700";

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

const boundAt = "2026-11-10T20:00:00.000Z";
const afterSend = Date.parse("2026-11-10T20:05:00.000Z");
const pending = [{ requestId, dialogueId, threadId, boundAt }] as const;

describe("Selarti response poller", () => {
  it("stays idle when the flag is off", async () => {
    const listPending = vi.fn();
    const readMessages = vi.fn();
    await expect(
      pollSelartiPendingResponses({
        enabled: false,
        taskId,
        companyId,
        listPending,
        readMessages,
        responses: { handle: vi.fn() },
        receipts: memoryReceipts(),
      }),
    ).resolves.toEqual({ examined: 0, ingested: 0, skipped: 0 });
    expect(listPending).not.toHaveBeenCalled();
    expect(readMessages).not.toHaveBeenCalled();
  });

  it("ingests one unseen bot reply as an internal proposal and skips user rows", async () => {
    const receipts = memoryReceipts();
    const handle = vi.fn<
      (
        raw: unknown,
        context?: { messageReceiptKey?: string },
      ) => Promise<{ status: string }>
    >(async (_raw, context) => {
      if (context?.messageReceiptKey)
        receipts.markComplete(context.messageReceiptKey);
      return { status: "accepted" };
    });
    const readMessages = vi.fn(async () => ({
      kind: "page" as const,
      messages: [
        {
          id: "user-message",
          text: "Привет",
          messageType: "user",
          taskId,
          companyId,
          threadId,
        },
        {
          id: "bot-message",
          text: "Ответ без ссылок.",
          messageType: "bot",
          taskId,
          companyId,
          threadId,
          createdAt: afterSend,
        },
      ],
    }));
    const result = await pollSelartiPendingResponses({
      enabled: true,
      taskId,
      companyId,
      listPending: async () => pending,
      readMessages,
      responses: { handle },
      receipts,
    });
    expect(result).toEqual({ examined: 1, ingested: 1, skipped: 0 });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(handle.mock.calls[0]![0] as Record<string, unknown>).sort(),
    ).toEqual(["dialogueId", "requestId", "text", "threadId", "version"]);
    expect(handle.mock.calls[0]![0]).toEqual({
      version: 1,
      requestId,
      dialogueId,
      threadId: requestId,
      text: "Ответ без ссылок.",
    });
    expect(JSON.stringify(handle.mock.calls[0]![0])).not.toContain(threadId);

    await pollSelartiPendingResponses({
      enabled: true,
      taskId,
      companyId,
      listPending: async () => pending,
      readMessages,
      responses: { handle },
      receipts,
    });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("does not choose among several unseen provider replies", async () => {
    const handle = vi.fn<(raw: unknown) => Promise<{ status: string }>>(
      async () => ({ status: "accepted" }),
    );
    const result = await pollSelartiPendingResponses({
      enabled: true,
      taskId,
      companyId,
      listPending: async () => pending,
      readMessages: async () => ({
        kind: "page",
        messages: [
          {
            id: "bot-1",
            text: "Первый",
            messageType: "bot",
            taskId,
            companyId,
            createdAt: afterSend,
          },
          {
            id: "bot-2",
            text: "Второй",
            messageType: "operator",
            taskId,
            companyId,
            createdAt: afterSend + 1_000,
          },
        ],
      }),
      responses: { handle },
      receipts: memoryReceipts(),
    });
    expect(result).toEqual({ examined: 1, ingested: 0, skipped: 1 });
    expect(handle).not.toHaveBeenCalled();
  });

  it("does not ingest an older reply or a thread with two open requests", async () => {
    const handle = vi.fn<(raw: unknown) => Promise<{ status: string }>>(
      async () => ({ status: "accepted" }),
    );
    const older = await pollSelartiPendingResponses({
      enabled: true,
      taskId,
      companyId,
      listPending: async () => pending,
      readMessages: async () => ({
        kind: "page",
        messages: [
          {
            id: "old-bot",
            text: "Старый ответ.",
            messageType: "bot",
            taskId,
            companyId,
            createdAt: Date.parse("2026-11-10T19:00:00.000Z"),
          },
        ],
      }),
      responses: { handle },
      receipts: memoryReceipts(),
    });
    expect(older).toEqual({ examined: 1, ingested: 0, skipped: 0 });
    expect(handle).not.toHaveBeenCalled();

    const shared = await pollSelartiPendingResponses({
      enabled: true,
      taskId,
      companyId,
      listPending: async () => [
        pending[0],
        {
          requestId: `sha256:${"c".repeat(64)}`,
          dialogueId: "00000000-0000-4000-8000-000000000778",
          threadId,
          boundAt,
        },
      ],
      readMessages: async () => ({
        kind: "page",
        messages: [
          {
            id: "new-bot",
            text: "Новый ответ.",
            messageType: "bot",
            taskId,
            companyId,
            createdAt: afterSend,
          },
        ],
      }),
      responses: { handle },
      receipts: memoryReceipts(),
    });
    expect(shared).toEqual({ examined: 2, ingested: 0, skipped: 1 });
    expect(handle).not.toHaveBeenCalled();
  });

  it("keeps a bot reply timestamped in the same second as the send", async () => {
    const handle = vi.fn<(raw: unknown) => Promise<{ status: string }>>(
      async () => ({ status: "accepted" }),
    );
    const sentAt = "2026-11-10T20:00:00.500Z";
    const result = await pollSelartiPendingResponses({
      enabled: true,
      taskId,
      companyId,
      listPending: async () => [
        { requestId, dialogueId, threadId, boundAt: sentAt },
      ],
      readMessages: async () => ({
        kind: "page",
        messages: [
          {
            id: "fast-bot",
            text: "Быстрый ответ.",
            messageType: "bot",
            taskId,
            companyId,
            createdAt: Date.parse("2026-11-10T20:00:00.000Z"),
          },
        ],
      }),
      responses: { handle },
      receipts: memoryReceipts(),
    });
    expect(result).toEqual({ examined: 1, ingested: 1, skipped: 0 });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("reports acquisition failure without reading threads", async () => {
    const listPending = vi.fn();
    const run = createSelartiResponsePollRunner({
      apiKey: `synthetic-key`,
      companyId,
      taskId,
      aiId: "ai-1",
      listPending,
      responses: { handle: vi.fn() },
      receipts: memoryReceipts(),
      acquire: async () => ({
        kind: "unavailable",
        code: "acquisition_failed",
      }),
    });
    await expect(run()).resolves.toEqual({
      examined: 0,
      ingested: 0,
      skipped: 1,
    });
    expect(listPending).not.toHaveBeenCalled();
  });
});
