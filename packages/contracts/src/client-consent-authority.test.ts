import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { clientConsentAuthoritySchema } from "./client-consent-authority.js";
const stamp = () => ({
  v: 1,
  subjectId: randomUUID(),
  purposes: {
    client_messaging: {
      decisionId: randomUUID(),
      revision: "9007199254740993",
    },
  },
});
describe("original authority contract", () => {
  it("preserves PostgreSQL bigint revisions exactly", () =>
    expect(
      clientConsentAuthoritySchema.parse(stamp()).purposes.client_messaging
        .revision,
    ).toBe("9007199254740993"));
  it.each([0, 1, 9007199254740992, "0", "01", "1.5", "9223372036854775808"])(
    "denies narrowed or noncanonical revision %s",
    (revision) => {
      const s = stamp();
      expect(
        clientConsentAuthoritySchema.safeParse({
          ...s,
          purposes: {
            client_messaging: { ...s.purposes.client_messaging, revision },
          },
        }).success,
      ).toBe(false);
    },
  );
  it("denies extra purposes, extra fields, unknown versions and missing messaging", () => {
    const s = stamp();
    for (const value of [
      { ...s, v: 2 },
      { ...s, extra: true },
      {
        ...s,
        purposes: { ...s.purposes, expert_note: s.purposes.client_messaging },
      },
      { ...s, purposes: {} },
      {
        ...s,
        purposes: {
          client_messaging: { ...s.purposes.client_messaging, extra: true },
        },
      },
    ])
      expect(clientConsentAuthoritySchema.safeParse(value).success).toBe(false);
  });
});
