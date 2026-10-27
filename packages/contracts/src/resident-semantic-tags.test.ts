import { expect, it } from "vitest";
import {
  normalizeTag,
  canonicalTag,
  exactTagCandidates,
  tagLabelSchema,
  tagSelectionSchema,
  type SemanticCatalogueTag,
} from "./resident-semantic-tags.js";
const catalogue: SemanticCatalogueTag[] = [
  {
    id: "1",
    tagValue: "панические_атаки",
    displayLabel: "#панические_атаки",
    synonyms: [{ term: "ПА" }, { term: "паника" }],
    weightScore: 5,
    isActive: true,
  },
  {
    id: "2",
    tagValue: "тревожность",
    displayLabel: "#тревожность",
    synonyms: [{ term: "тревога" }],
    weightScore: 5,
    isActive: true,
  },
];
it("matches only complete Unicode words and approved aliases in exact-only fallback", () => {
  expect(
    exactTagCandidates("ПА; тревога", catalogue).map((c) => [c.id, c.score]),
  ).toEqual([
    ["1", 100],
    ["2", 100],
  ]);
  expect(exactTagCandidates("лопата", catalogue)).toEqual([]);
  expect(
    exactTagCandidates("не работаю с паникой; без тревога", catalogue),
  ).toEqual([]);
});
it("normalizes consistent identity without inventing morphology aliases", () => {
  expect(normalizeTag("  #ПОРТРЕТНАЯ_СЪЁМКА  ")).toBe("портретная съемка");
  expect(canonicalTag("#ПА", catalogue)).toBe(
    canonicalTag("Панические_атаки", catalogue),
  );
  expect(canonicalTag("авторская паника", catalogue)).toBe(
    "custom:авторская паника",
  );
  expect(canonicalTag("тревогой", catalogue)).toBe("custom:тревогой");
});
it("bounds custom and exact confirmed selection labels", () => {
  expect(tagLabelSchema.safeParse("#приворот").success).toBe(true);
  expect(tagLabelSchema.safeParse("\u200bпаника").success).toBe(false);
  expect(tagLabelSchema.safeParse("x".repeat(81)).success).toBe(false);
  expect(
    tagSelectionSchema.safeParse(
      Array.from({ length: 21 }, (_, i) => "Тема " + i),
    ).success,
  ).toBe(false);
});
it("punctuated negation uses the matching token stream without false panic proposals", () => {
  for (const text of [
    "тревожность (не паника)",
    "Исключая: паника",
    "без: ПА",
    "[не] паника",
  ])
    expect(exactTagCandidates(text, catalogue).some((c) => c.id === "1")).toBe(
      false,
    );
  expect(
    exactTagCandidates("тревожность; исключая: паника", catalogue).map(
      (c) => c.id,
    ),
  ).toEqual(["2"]);
  expect(
    exactTagCandidates("(паника); тревога", catalogue).map((c) => c.id),
  ).toEqual(["1", "2"]);
});
