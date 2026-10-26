import { describe, expect, it } from "vitest";
import {
  applyResidentPatch,
  residentForm,
  residentRoles,
} from "./resident-verification-form.js";
const common = {
  primaryRole: "EXPERT",
  roles: ["EXPERT"],
  category: "BASIC",
  tax: "INDIVIDUAL",
  city: "Москва",
  socialLinks: ["https://example.com/me"],
  motivation: "Хочу участвовать",
  specialization: "Консультации",
  averageCheckMinor: "1500001",
  education: [
    {
      kind: "document",
      fileId: "private-file",
      mimeType: "application/pdf",
      size: 100,
    },
  ],
};
describe("resident verification form", () => {
  it.each(residentRoles)(
    "requires common facts for %s and permits partial drafts",
    (role) => {
      const draft = applyResidentPatch(
        {},
        { primaryRole: role, roles: [role] },
      );
      expect(residentForm(draft).missing).toEqual(
        expect.arrayContaining([
          "category",
          "tax",
          "city",
          "socialLinks",
          "motivation",
        ]),
      );
    },
  );
  it("unions roles and preserves answers when roles change", () => {
    const draft = applyResidentPatch(
      {},
      { ...common, roles: ["EXPERT", "CENTER", "ESOTERIC"] },
    );
    expect(residentForm(draft).missing).toEqual(
      expect.arrayContaining([
        "propertyEvidence",
        "capacity",
        "amenities",
        "path",
        "cases",
      ]),
    );
    const changed = applyResidentPatch(draft, {
      primaryRole: "OTHER",
      roles: ["OTHER"],
    });
    expect(changed.education).toEqual(common.education);
    expect(residentForm(changed).missing).not.toContain("education");
  });
  it("rejects authority fields, duplicate roles, invalid primary, unsafe money and documents", () => {
    for (const patch of [
      { constructor: "x" },
      { toString: "x" },
      JSON.parse('{"__proto__":"x"}'),
      { status: "APPROVED_BASIC" },
      { roles: ["EXPERT", "EXPERT"] },
      { primaryRole: "CENTER", roles: ["EXPERT"] },
      { averageCheckMinor: "1.5" },
      { capacity: 0 },
      { education: [{ kind: "url", fileId: "x" }] },
    ])
      expect(() => applyResidentPatch({}, patch)).toThrow(
        "resident_patch_invalid",
      );
  });
  it("keeps unknown education manual and a high check as a signal only", () => {
    const state = residentForm(applyResidentPatch({}, common));
    expect(state.missing).toEqual([]);
    expect(state.educationPolicy).toBe("unknown_manual_review");
    expect(state.reviewSignals).toContain("average_check_over_15000");
    expect(
      residentForm(applyResidentPatch({}, { ...common, education: [] }), {
        version: "test-v1",
        education: "required",
      }).missing,
    ).toContain("education");
    expect(
      residentForm(applyResidentPatch({}, { ...common, education: [] }), {
        version: "test-v1",
        education: "optional",
      }).missing,
    ).not.toContain("education");
  });
  it("does not impose diploma rules on ESOTERIC or OTHER", () => {
    for (const role of ["ESOTERIC", "OTHER"])
      expect(
        residentForm(
          applyResidentPatch(
            {},
            {
              ...common,
              primaryRole: role,
              roles: [role],
              education: [],
              path: "Опыт",
              cases: "Кейсы",
            },
          ),
        ).missing,
      ).toEqual([]);
  });
});
it("remediation: normalizes HTTPS and rejects credentials and shared prohibited characters", () => {
  expect(
    applyResidentPatch({}, { socialLinks: ["HTTPS://Example.COM/Profile"] })
      .socialLinks,
  ).toEqual(["https://example.com/Profile"]);
  for (const link of [
    "https://user:pw@example.com/me",
    "https://example.com/\u0001",
    "https://example.com/white space",
    "https://example.com\\evil",
  ])
    expect(() => applyResidentPatch({}, { socialLinks: [link] })).toThrow(
      "resident_patch_invalid",
    );
});
it("remediation: bounds cumulative serialized multilingual document captions", () => {
  const docs = Array.from({ length: 10 }, (_, i) => ({
    kind: "document",
    fileId: `private_${i}`,
    mimeType: null,
    size: null,
    caption: "я".repeat(3000),
  }));
  const first = applyResidentPatch({}, { education: docs });
  expect(first.education).toHaveLength(10);
  expect(() => applyResidentPatch(first, { propertyEvidence: docs })).toThrow(
    "resident_draft_too_large",
  );
  expect(first.propertyEvidence).toBeUndefined();
});
