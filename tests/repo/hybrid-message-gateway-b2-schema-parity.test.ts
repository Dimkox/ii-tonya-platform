import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "packages/db/migrations/0035_hybrid_message_gateway_b2.sql",
  "utf8",
);

describe("B2 schema/migration parity", () => {
  it("defines monotonic delivery, immutable proposals, order barriers and tombstones", () => {
    for (const fragment of [
      "next_delivery_sequence bigint NOT NULL DEFAULT 0",
      "integration_outbox_dialogue_sequence_unique",
      "integration_outbox_dialogue_order_claim_idx",
      "CREATE TABLE selarti_response_proposals",
      "selarti_response_proposals_expiry_check",
      "CREATE TABLE dialogue_deliveries",
      "dialogue_deliveries_dialogue_sequence_unique",
      "CREATE TABLE dialogue_inbound_tombstones",
      "dialogue_inbound_tombstones_scope_unique",
    ])
      expect(migration).toContain(fragment);
  });

  it("journals migration 0035 exactly once", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(
      journal.entries.filter(
        (entry) => entry.tag === "0035_hybrid_message_gateway_b2",
      ),
    ).toHaveLength(1);
    expect(journal.entries.at(-1)?.idx).toBe(35);
  });
});
