import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../client.js";
import { PostgresSelartiResponseIngressRepository } from "./selarti-response-ingress-repository.js";

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
});
