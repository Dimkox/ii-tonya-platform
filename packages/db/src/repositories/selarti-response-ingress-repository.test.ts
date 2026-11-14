import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../client.js";
import {
  pageOfUnambiguousThreads,
  PostgresSelartiResponseIngressRepository,
} from "./selarti-response-ingress-repository.js";

const requestId = `sha256:${"a".repeat(64)}`;
const otherId = `sha256:${"b".repeat(64)}`;
const dialogueId = "00000000-0000-4000-8000-000000000501";

describe("Selarti pending lookup", () => {
  const repository = (rows: readonly unknown[]) =>
    new PostgresSelartiResponseIngressRepository(
      {
        execute: async () => ({ rows }),
      } as unknown as Pick<DrizzleDb, "execute">,
      "bot-a",
    );

  it("treats two sql rows as ambiguous before discarding one", async () => {
    await expect(
      repository([
        { requestId: "not-a-request", dialogueId },
        { requestId, dialogueId },
      ]).findPending("123456789"),
    ).resolves.toEqual({ kind: "ambiguous" });
  });

  it("returns the single valid pending request", async () => {
    await expect(
      repository([{ requestId, dialogueId }]).findPending("123456789"),
    ).resolves.toEqual({ kind: "one", requestId, dialogueId });
    await expect(
      repository([{ requestId: otherId, dialogueId: "nope" }]).findPending(
        "123456789",
      ),
    ).resolves.toEqual({ kind: "none" });
  });

  it("drops an expired pending request before the ambiguity limit", () => {
    const source = readFileSync(
      new URL("./selarti-response-ingress-repository.ts", import.meta.url),
      "utf8",
    );
    const findPending = source.slice(
      source.indexOf("async findPending"),
      source.indexOf("async listBoundPending"),
    );
    const deadline = findPending.indexOf(
      "(o.payload->>'deadline')::timestamptz > clock_timestamp()",
    );
    const limit = findPending.indexOf("limit 2");
    expect(deadline).toBeGreaterThan(0);
    expect(deadline).toBeLessThan(limit);
  });

  it("counts a shared thread across the whole pending set before the page limit", () => {
    const source = readFileSync(
      new URL("./selarti-response-ingress-repository.ts", import.meta.url),
      "utf8",
    );
    const listBound = source.slice(
      source.indexOf("async listBoundPending"),
      source.indexOf("async lookup"),
    );
    const counts = listBound.indexOf("count(*)::int as open_count");
    const sentAt = listBound.indexOf("min(created_at) as sent_at");
    const bound = listBound.indexOf('p.sent_at as "boundAt"');
    const limit = listBound.lastIndexOf("limit");
    expect(sentAt).toBeGreaterThan(0);
    expect(counts).toBeGreaterThan(sentAt);
    expect(bound).toBeGreaterThan(counts);
    expect(bound).toBeLessThan(limit);
    expect(listBound).not.toContain("bound.created_at");

    const shared = "thread-shared";
    const rows = [
      ...Array.from({ length: 19 }, (_, index) => ({
        threadId: `thread-${String(index)}`,
        requestId: `sha256:${String(index).padStart(64, "a")}`,
      })),
      { threadId: shared, requestId: requestId },
      { threadId: shared, requestId: otherId },
    ];
    const page = pageOfUnambiguousThreads(rows, 20);
    expect(page).toHaveLength(19);
    expect(page.some((row) => row.threadId === shared)).toBe(false);
  });
});
