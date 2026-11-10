import { describe, expect, it } from "vitest";
import {
  SELARTI_ALL_MESSAGES_FIXTURE,
  assertSelartiOfficialResponseFixture,
} from "./selarti-official-response-fixture.js";

describe("official Selarti all_messages fixture", () => {
  it("matches the documented webhook sample and keeps extra fields", () => {
    expect(() => assertSelartiOfficialResponseFixture()).not.toThrow();
    expect(SELARTI_ALL_MESSAGES_FIXTURE).toMatchObject({
      wh_type: "all_messages",
      message_type: "bot",
      external_chat_id: "123456789",
      task_id: "1721129985149x478019552540622850",
      thread_id: "1731336491572x316716105037601100",
      manager_id: "4q",
    });
    expect(SELARTI_ALL_MESSAGES_FIXTURE.message_text.length).toBeGreaterThan(0);
    expect(SELARTI_ALL_MESSAGES_FIXTURE.panel_url).toContain(
      "https://selarti.com/",
    );
  });
});
