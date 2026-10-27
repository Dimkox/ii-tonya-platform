import { describe, expect, it } from "vitest";
import {
  applyResidentPatch,
  residentForm,
  residentPolicy,
} from "./resident-verification-form.js";

describe("versioned resident forms", () => {
  it("uses final role fields only in v2 and preserves v1 required fields", () => {
    const draft = { roles: ["EXPERT"] as const };
    const v2 = residentForm({ roles: [...draft.roles] }, residentPolicy, 2);
    expect(v2.version).toBe(2);
    expect(v2.required).toEqual(
      expect.arrayContaining(["methods", "experienceYears", "cases"]),
    );
    expect(v2.required).not.toContain("education");
    expect(
      residentForm({ roles: [...draft.roles] }, residentPolicy, 1).required,
    ).not.toContain("methods");
  });
  it.each([
    [
      "CENTER",
      [
        "premisesType",
        "tourMedia",
        "propertyEvidence",
        "capacity",
        "amenities",
      ],
    ],
    ["ORGANIZER", ["eventFormat", "programme", "speakers", "pastEvents"]],
    ["EDU_PROJECT", ["projectName", "teachingTeam", "graduateReviews"]],
    ["ESOTERIC", ["path", "cases"]],
    ["OTHER", ["path", "cases"]],
  ] as const)("collects %s fields", (role, fields) => {
    expect(residentForm({ roles: [role] }, residentPolicy, 2).required).toEqual(
      expect.arrayContaining([...fields]),
    );
  });
  it("keeps multi-role union and admits no-status without upgrading legacy validation", () => {
    expect(
      residentForm(
        { roles: ["EXPERT", "CENTER", "EDU_PROJECT"] },
        residentPolicy,
        2,
      ).required,
    ).toEqual(expect.arrayContaining(["methods", "tourMedia", "projectName"]));
    expect(
      applyResidentPatch(
        {},
        { tax: "INDIVIDUAL_NO_STATUS", experienceYears: 0 },
        2,
      ),
    ).toEqual({ tax: "INDIVIDUAL_NO_STATUS", experienceYears: 0 });
    expect(() =>
      applyResidentPatch({}, { tax: "INDIVIDUAL_NO_STATUS" }, 1),
    ).toThrow();
  });
  it("accepts bounded private DOCX/video references in v2 only", () => {
    const doc = {
      kind: "document",
      fileId: "private_1",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
    };
    const video = {
      kind: "video",
      fileId: "private_2",
      mimeType: "video/mp4",
      size: 100,
    };
    expect(
      applyResidentPatch({}, { education: [doc], tourMedia: [video] }, 2),
    ).toEqual({ education: [doc], tourMedia: [video] });
    expect(() => applyResidentPatch({}, { education: [doc] }, 1)).toThrow();
    expect(() =>
      applyResidentPatch(
        {},
        { tourMedia: [{ ...video, size: 21 * 1024 * 1024 }] },
        2,
      ),
    ).toThrow();
  });
});
