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

function memoryReceipts(): SelartiResponseReceipts {
  const state = new Map<string, "processing" | "complete" | "failed">();
  let sequence = 0;
  return {
    async claim(messageKey) {
      const current = state.get(messageKey);
      if (current === "complete") return { kind: "duplicate" };
      if (current === "processing") return { kind: "busy" };
      state.set(messageKey, "processing");
      return { kind: "claimed", claimId: `poll-${String(++sequence)}` };
    },
    async complete() {
      for (const [key, status] of state) {
        if (status === "processing") state.set(key, "complete");
      }
    },
    async release() {
      for (const [key, status] of state) {
        if (status === "processing") state.set(key, "failed");
      }
    },
  };
}

const pending = [{ requestId, dialogueId, threadId }] as const;

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
    const handle = vi.fn<(raw: unknown) => Promise<{ status: string }>>(
      async () => ({ status: "accepted" }),
    );
    const receipts = memoryReceipts();
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
          },
          {
            id: "bot-2",
            text: "Второй",
            messageType: "operator",
            taskId,
            companyId,
          },
        ],
      }),
      responses: { handle },
      receipts: memoryReceipts(),
    });
    expect(result).toEqual({ examined: 1, ingested: 0, skipped: 1 });
    expect(handle).not.toHaveBeenCalled();
  });

  it("reports acquisition failure without reading threads", async () => {
    const listPending = vi.fn();
    const run = createSelartiResponsePollRunner({
      apiKey: "synthetic-key",
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
