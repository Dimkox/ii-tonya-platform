import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "packages/db/migrations/0034_hybrid_message_gateway_b1.sql",
  "utf8",
);
const integrationSchema = readFileSync(
  "packages/db/src/schema/integration.ts",
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
  it("journals B1 exactly once and advances through the current schema", () => {
    const journal = JSON.parse(
      readFileSync("packages/db/migrations/meta/_journal.json", "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    expect(
      journal.entries.filter(
        (entry) => entry.tag === "0034_hybrid_message_gateway_b1",
      ),
    ).toHaveLength(1);
    // 0041 remains an exact historical contract, rather than a moving tail.
    expect(journal.entries.filter((entry) => entry.idx === 41)).toEqual([
      {
        idx: 41,
        version: "7",
        when: 1791504000000,
        tag: "0041_client_erasure_requests",
        breakpoints: true,
      },
    ]);
    // The reviewed additive 0070 SQL/state projection is the current journal tail.
    expect(journal.entries.at(-1)).toEqual({
      idx: 70,
      version: "7",
      when: 1793152800001,
      tag: "0070_resident_native_scheduling",
      breakpoints: true,
    });
  });
  it("mirrors every B3 policy numeric and derived-cost bound in Drizzle", () => {
    expect(integrationSchema).toContain(
      "${table.globalCapRubMinor}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.globalWarningRubMinor}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.globalSoftRubMinor}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.perUserWarningRubMinor}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.perUserSoftRubMinor}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.perUserHardRubMinor}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.officialUsdRubQuoteMicros}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.usdMicrosPerRequest}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.usdMicrosPerUnit}<=999999999999",
    );
    expect(integrationSchema).toContain(
      "${table.worstCaseBillableUnits}<=1000000",
    );
    expect(integrationSchema).toContain("${derivedWorstCaseRubMinor}>0");
    expect(integrationSchema).toContain(
      "${derivedWorstCaseRubMinor}<=999999999999",
    );
  });
});
