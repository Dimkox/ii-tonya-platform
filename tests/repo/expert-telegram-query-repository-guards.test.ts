import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL(
    "../../packages/db/src/repositories/expert-telegram-query-repository.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("expert Telegram query repository guards", () => {
  it("rechecks active verified Telegram ownership in each read", () => {
    expect(
      source.match(/ci\.provider = 'telegram'/gu)?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(source.match(/e\.active/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/e\.verified/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/u\.active/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps view_client isolated from booking transitions", () => {
    expect(source).toContain("callback_action = 'view_client'");
    expect(source).not.toContain("transitionFromTelegramCallback");
    expect(source).not.toContain("transitionAndPublish");
  });

  it("atomically consumes, reads minimized fields, and writes content-free audit", () => {
    expect(source).toContain("with eligible as");
    expect(source).toContain("), consumed as (");
    expect(source).toContain("callback_consumed_at =");
    expect(source).toContain("insert into audit_events");
    expect(source).toContain("'reservation.client_view'");
    expect(source).not.toMatch(/phone|email|meeting_url|content_encrypted/iu);
  });

  it("bounds selections and safely parses aggregate counts", () => {
    expect(source).toContain("limit 20");
    expect(source).toContain("Number.MAX_SAFE_INTEGER");
    expect(source).toContain("interval '10 minutes'");
  });
});
