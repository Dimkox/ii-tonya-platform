import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("test expert Telegram repository guards", () => {
  it("binds identity to bot, user and private chat and fails multiple matches closed", () => {
    const source = readFileSync(
      "packages/db/src/repositories/test-expert-telegram-repository.ts",
      "utf8",
    );
    expect(source).toMatch(/ci\.bot_key=\$\{input\.botKey\}/u);
    expect(source).toMatch(/ci\.external_id=\$\{input\.telegramUserId\}/u);
    expect(source).toMatch(/ci\.external_chat_id=\$\{input\.chatId\}/u);
    expect(source).toMatch(/limit 2/iu);
    expect(source).toContain("rows.length !== 1");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("test_expert_deterministic_requests");
    expect(source).toContain("request_idempotency_conflict");
  });

  it("uses B3 admission and durable B1/B2 topics without a direct provider call", () => {
    const source = readFileSync(
      "packages/db/src/repositories/test-expert-telegram-repository.ts",
      "utf8",
    );
    expect(source).toContain("reserveSelartiCost");
    expect(source).toContain("'selarti.request.v1'");
    expect(source).toContain("'telegram.send_text.v1'");
    expect(source).toContain("test_expert_prompt_assets");
    expect(source).toContain("selarti_response_proposals");
    expect(source).not.toMatch(/dispatch\s*\(/u);
    expect(source).not.toMatch(/provider\s*\(/u);
  });

  it("keeps server composition free of in-memory prompt authority and direct dispatch", () => {
    const server = readFileSync("apps/api/src/server.ts", "utf8");
    expect(server).not.toContain("approvedPromptVersions");
    expect(server).not.toContain("testExpertProviderComposition");
    expect(server).not.toMatch(/\.dispatch\(text\)/u);
  });

  it("converges trial consumption only inside the existing B2 response transaction", () => {
    const source = readFileSync(
      "packages/db/src/repositories/selarti-proposal-repository.ts",
      "utf8",
    );
    expect(source).toContain("test_expert_reservations");
    expect(source).toContain("reserved_units=reserved_units-2");
    expect(source).toContain("'outcome_applied'");
    expect(source).toContain("'telegram.send_text.v1'");
  });
});
