import { describe, expect, it } from "vitest";
import {
  consentPurposeSchema,
  deriveDialogueReadiness,
  isConsentScopeAllowed,
} from "./consent-contracts.js";

describe("client consent authority", () => {
  it.each([
    "client_profile",
    "client_messaging",
    "expert_note",
    "expert_handoff",
    "follow_up",
  ])("accepts reviewed purpose %s", (purpose) =>
    expect(consentPurposeSchema.parse(purpose)).toBe(purpose),
  );

  it("rejects unknown purposes and never widens scope", () => {
    expect(() => consentPurposeSchema.parse("diagnosis_export")).toThrow();
    expect(
      isConsentScopeAllowed({
        purpose: "client_profile",
        requestedCategory: "special_health",
      }),
    ).toBe(false);
  });

  it.each([
    [
      {
        messaging: true,
        profile: true,
        expertNote: true,
        expertHandoff: true,
        followUp: true,
      },
      true,
    ],
    [
      {
        messaging: true,
        profile: true,
        expertNote: true,
        expertHandoff: false,
        followUp: true,
      },
      false,
    ],
    [
      {
        messaging: true,
        profile: true,
        expertNote: true,
        expertHandoff: true,
        followUp: false,
      },
      false,
    ],
  ])(
    "derives dialogue readiness from every required grant",
    (grants, ready) => {
      expect(deriveDialogueReadiness(grants)).toBe(ready);
    },
  );
});
