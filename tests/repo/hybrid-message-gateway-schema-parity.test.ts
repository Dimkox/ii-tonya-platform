import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "packages/db/migrations/0034_hybrid_message_gateway_b1.sql",
  "utf8",
);
describe("B1 schema/migration parity", () => {
  it("uses bot-scoped inbound uniqueness and matching identity indexes", () => {
    expect(migration).toContain(
      "UNIQUE(provider, bot_key, provider_update_id)",
    );
    expect(migration).toContain("WHERE bot_key IS NULL");
    expect(migration).toContain(
      "WHERE provider = 'telegram' AND bot_key IS NOT NULL AND external_chat_id IS NOT NULL AND status = 'active'",
    );
    expect(migration).toContain(
      "CONSTRAINT \"dialogue_inbound_expiry_check\" CHECK (expires_at = created_at + interval '30 days')",
    );
    expect(migration).toContain(
      'CREATE INDEX "dialogue_inbound_dialogue_idx" ON dialogue_inbound(dialogue_id, created_at)',
    );
    expect(migration).toContain(
      'CREATE INDEX "dialogue_inbound_expiry_idx" ON dialogue_inbound(expires_at, id)',
    );
  });
  it("journals migration 0034 exactly once", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(
      journal.entries.filter(
        (entry) => entry.tag === "0034_hybrid_message_gateway_b1",
      ),
    ).toHaveLength(1);
    expect(journal.entries.at(-1)).toEqual({
      idx: 34,
      version: "7",
      when: 1788048000000,
      tag: "0034_hybrid_message_gateway_b1",
      breakpoints: true,
    });
  });
});
