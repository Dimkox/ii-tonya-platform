import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SCRUM-129 / LOC-01.1: public copy must not bind the launch to one city.
// The operator's legal address is a fact and stays as is (LOC-01.1 keeps
// postal details). Only these exact address fragments are allowed.
const CITY = /тамбов/iu;
const ALLOWED_LINE_FRAGMENTS = [
  'address: "392000, г. Тамбов, ул. А. Бебеля, 38"',
  'addressLocality: "Тамбов"',
];

const PUBLIC_COPY_GLOBS = [
  "apps/web/index.html",
  "apps/web/src/**/*.ts",
  "apps/*/src/**/*.ts",
  "packages/*/src/**/*.ts",
];

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.ts$/u.test(path);
}

function findCityBindingViolations(
  files: readonly { path: string; text: string }[],
): string[] {
  const violations: string[] = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, index) => {
      if (!CITY.test(line)) return;
      if (ALLOWED_LINE_FRAGMENTS.some((fragment) => line.includes(fragment)))
        return;
      violations.push(`${path}:${index + 1}`);
    });
  }
  return violations;
}

describe("neutral launch geography (SCRUM-129, LOC-01.1)", () => {
  it("public hero, SEO, bot and prompt sources do not name the city", () => {
    const paths = new Set(
      PUBLIC_COPY_GLOBS.flatMap((pattern) => globSync(pattern)).filter(
        (path) => !isTestFile(path) && !path.includes("/dist/"),
      ),
    );
    const files = [...paths].map((path) => ({
      path,
      text: readFileSync(path, "utf8"),
    }));
    expect(files.length).toBeGreaterThan(0);
    expect(findCityBindingViolations(files)).toEqual([]);
  });

  it("flags a city-bound hero line and keeps the legal address", () => {
    expect(
      findCityBindingViolations([
        { path: "hero.ts", text: 'title: "Тамбов и онлайн"' },
        {
          path: "content.ts",
          text: '    address: "392000, г. Тамбов, ул. А. Бебеля, 38",',
        },
      ]),
    ).toEqual(["hero.ts:1"]);
  });
});
