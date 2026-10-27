import { expect, it } from "vitest";
import { projectConsentScope } from "./consent-scope-export.js";

it("distinguishes absent scope from complete empty scope", () => {
  expect(projectConsentScope(null)).toEqual({
    scopeFields: null,
    scopeStatus: "absent",
  });
  expect(projectConsentScope({})).toEqual({
    scopeFields: {},
    scopeStatus: "complete",
  });
});

it.each([
  [],
  ["display_name"],
  ["timezone"],
  ["display_name", "timezone"],
  ["timezone", "display_name"],
])(
  "preserves exactly the allowed fields in original order: %j",
  (...fields) => {
    const input = { fields };
    expect(projectConsentScope(input)).toEqual({
      scopeFields: { fields },
      scopeStatus: "complete",
    });
  },
);

it.each([
  ["string", "synthetic-secret"],
  ["number", 7],
  ["boolean", false],
  ["array", []],
  ["array of objects", [{ fields: ["timezone"] }]],
  ["missing input", undefined],
  ["unknown key", { nested: { sessionKey: "synthetic-secret" } }],
  [
    "extra key",
    { fields: ["timezone"], recipientId: "synthetic-private-recipient" },
  ],
  ["null fields", { fields: null }],
  ["string fields", { fields: "timezone" }],
  ["object fields", { fields: { timezone: true } }],
  ["nested fields", { fields: [{ token: "synthetic-secret" }] }],
  ["unknown field", { fields: ["expert_note"] }],
  ["non-string field", { fields: [1] }],
  ["duplicate fields", { fields: ["timezone", "timezone"] }],
  [
    "more than two fields",
    { fields: ["timezone", "display_name", "timezone"] },
  ],
  ["case mismatch", { fields: ["Timezone"] }],
  ["whitespace", { fields: ["timezone "] }],
] as const)(
  "redacts the whole %s shape without leaking values",
  (_name, input) => {
    expect(projectConsentScope(input)).toEqual({
      scopeFields: null,
      scopeStatus: "redacted",
    });
  },
);

it("does not mutate or retain mutable references to the original scope", () => {
  const fields = Object.freeze(["timezone", "display_name"]);
  const input = Object.freeze({ fields });
  const result = projectConsentScope(input);
  expect(result).toEqual({
    scopeFields: { fields: ["timezone", "display_name"] },
    scopeStatus: "complete",
  });
  expect(result.scopeFields).not.toBe(input);
  expect((result.scopeFields as { fields: unknown }).fields).not.toBe(fields);
  expect(input).toEqual({ fields: ["timezone", "display_name"] });
});
