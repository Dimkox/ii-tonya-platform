import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DrizzleDb } from "../client.js";
import { sealSelartiMessageReceipt } from "./selarti-proposal-repository.js";

describe("Selarti message receipt", () => {
  it("records a valid message key and ignores anything else", async () => {
    const calls: unknown[] = [];
    const tx = {
      execute: async (query: unknown) => {
        calls.push(query);
        return { rows: [] };
      },
    } as unknown as Pick<DrizzleDb, "execute">;
    await sealSelartiMessageReceipt(tx, undefined);
    await sealSelartiMessageReceipt(tx, "not-a-receipt");
    expect(calls).toHaveLength(0);
    await sealSelartiMessageReceipt(tx, `sha256:${"a".repeat(64)}`);
    expect(calls).toHaveLength(1);
  });

  it("seals the receipt in the same transaction as the proposal decision", () => {
    const source = readFileSync(
      new URL("./selarti-proposal-repository.ts", import.meta.url),
      "utf8",
    );
    const accept = source.slice(source.indexOf("async accept("));
    const transaction = accept.indexOf("return this.db.transaction");
    const seal = accept.indexOf(
      "await sealSelartiMessageReceipt(tx, input.messageReceiptKey)",
    );
    expect(transaction).toBeGreaterThan(0);
    expect(seal).toBeGreaterThan(transaction);
    expect(accept.slice(0, transaction)).not.toContain(
      "sealSelartiMessageReceipt",
    );
  });
});
