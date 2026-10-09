import { expect, it } from "vitest";
import { projectConsentPresentation } from "./consent-presentation-export.js";

const valid = {
  id: "owner-bound-presentation",
  createdAt: "2026-10-09T12:34:56.123+03:00",
  consumedAt: "2026-10-09T12:35:01.456+03:00",
};

it("preserves a missing presentation", () => {
  expect(projectConsentPresentation(null)).toBeNull();
});

it("normalizes valid timestamps to ISO without changing the input", () => {
  const input = Object.freeze({ ...valid });
  expect(projectConsentPresentation(input)).toEqual({
    id: "owner-bound-presentation",
    createdAt: "2026-10-09T09:34:56.123Z",
    consumedAt: "2026-10-09T09:35:01.456Z",
  });
  expect(input).toEqual(valid);
});

it("preserves null consumption without inventing a date", () => {
  expect(projectConsentPresentation({ ...valid, consumedAt: null })).toEqual({
    id: "owner-bound-presentation",
    createdAt: "2026-10-09T09:34:56.123Z",
    consumedAt: null,
  });
});

it.each([
  "infinity",
  "-infinity",
  "invalid-date",
  "",
  "+999999-01-01T00:00:00Z",
])(
  "drops presentation for invalid createdAt %j even with null consumption",
  (createdAt) => {
    expect(projectConsentPresentation({ ...valid, createdAt })).toBeNull();
    expect(
      projectConsentPresentation({ ...valid, createdAt, consumedAt: null }),
    ).toBeNull();
  },
);

it.each([
  "infinity",
  "-infinity",
  "invalid-date",
  "",
  "+999999-01-01T00:00:00Z",
])("drops presentation for non-null invalid consumedAt %j", (consumedAt) => {
  expect(projectConsentPresentation({ ...valid, consumedAt })).toBeNull();
});

it("keeps subsequent valid evidence exportable after non-finite timestamps", () => {
  const inputs = [
    { ...valid, createdAt: "-infinity", consumedAt: "infinity" },
    valid,
  ];
  expect(inputs.map(projectConsentPresentation)).toEqual([
    null,
    {
      id: "owner-bound-presentation",
      createdAt: "2026-10-09T09:34:56.123Z",
      consumedAt: "2026-10-09T09:35:01.456Z",
    },
  ]);
});
