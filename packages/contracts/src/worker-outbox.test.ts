import { describe, expect, it } from "vitest";

import {
  CLIENT_CATALOG_OUTBOX_TOPICS,
  LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
} from "./worker-outbox.js";

describe("worker outbox provider isolation", () => {
  it("never exports or claims booking provider topics", () => {
    expect(LOCAL_OPERATOR_CASE_OUTBOX_TOPICS).toEqual([
      "safety.operator_escalation",
      "admin.negative_feedback",
    ]);
    expect(CLIENT_CATALOG_OUTBOX_TOPICS).toEqual([
      ...LOCAL_OPERATOR_CASE_OUTBOX_TOPICS,
      "catalog.show",
    ]);
    expect(CLIENT_CATALOG_OUTBOX_TOPICS.join("\n")).not.toMatch(
      /booking|conversation|planerka|provider|selarti|telegram/iu,
    );
  });
});
