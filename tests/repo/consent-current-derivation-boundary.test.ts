import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// D2 карты W1: «текущее решение по цели согласия» выводилось несколькими несовместимыми
// способами, и расходился исход на ничью (две записи в одном `created_at`). Формула теперь одна
// — packages/db/src/repositories/consent-current.ts. Охранник не даёт завести вторую: он ищет
// признаки деривации (агрегат по самому позднему мгновению, distinct-on по цели, тай-брейкер
// случайным uuid) в файлах, которые вообще обращаются к журналу `consents`.
const FORMULA_FILE = "packages/db/src/repositories/consent-current.ts";

const DERIVATION_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  ["агрегат по самому позднему мгновению", /bool_and\s*\(/u],
  ["max(created_at)", /max\(\s*[a-z_]*\.?\s*created_at\s*\)/u],
  ["distinct on (consent_type)", /distinct on \(\s*consent_type\s*\)/u],
  ["тай-брейкер случайным id", /order by[^;)]*\bid\s+desc/iu],
  [
    "одна «самая поздняя» строка с limit 1",
    /order by[^;)]*created_at\s+desc[\s\S]{0,120}?limit\s+1/iu,
  ],
  [
    "победитель по sequence вместо агрегата",
    /order by[^;)]*"sequence"\s+desc/iu,
  ],
];

const touchesConsents = (content: string): boolean =>
  /\b(from|into|update)\s+consents\b/iu.test(content);

function findConsentDerivationViolations(input: {
  path: string;
  content: string;
}): string[] {
  if (input.path === FORMULA_FILE || !touchesConsents(input.content)) return [];
  return DERIVATION_MARKERS.filter(([, pattern]) =>
    pattern.test(input.content),
  ).map(
    ([label]) =>
      `${input.path}: вывод «текущего решения» вне ${FORMULA_FILE} — ${label}`,
  );
}

describe("single current-consent derivation boundary", () => {
  it("keeps the current-decision formula only in consent-current.ts", () => {
    const violations: string[] = [];
    for (const file of globSync(["apps/**/*.ts", "packages/**/*.ts"], {
      exclude: ["**/dist/**", "**/*.test.ts", "**/*.testkit.ts"],
    })) {
      violations.push(
        ...findConsentDerivationViolations({
          path: file,
          content: readFileSync(file, "utf8"),
        }),
      );
    }
    expect(violations).toEqual([]);
  });

  it("ignores the formula file and files that never read the journal", () => {
    const code =
      "select bool_and(decision = 'granted') from consents latest order by id desc";
    expect(
      findConsentDerivationViolations({ path: FORMULA_FILE, content: code }),
    ).toEqual([]);
    expect(
      findConsentDerivationViolations({
        path: "packages/db/src/repositories/other.ts",
        content: "select bool_and(x) from reservations order by id desc",
      }),
    ).toEqual([]);
  });

  it.each([
    ["bool_and", "select bool_and(d) from consents", 1],
    [
      "max(created_at)",
      "select * from consents where created_at = (select max(created_at) from consents)",
      1,
    ],
    ["distinct on", "select distinct on (consent_type) * from consents", 1],
    [
      "uuid tie-breaker",
      "select decision from consents order by created_at desc, id desc limit 1",
      2,
    ],
    [
      "latest row by sequence",
      'select prior.decision from consents prior order by prior.created_at desc, "sequence" desc limit 1',
      2,
    ],
  ])(
    "catches a second derivation written as %s",
    (_label, sql, expectedViolations) => {
      expect(
        findConsentDerivationViolations({
          path: "packages/db/src/repositories/second-reader.ts",
          content: sql,
        }),
      ).toHaveLength(expectedViolations);
    },
  );
});
