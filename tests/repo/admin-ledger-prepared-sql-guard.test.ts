import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminLedgerIntegration = readFileSync(
  "tests/integration/admin-ledger.test.ts",
  "utf8",
);
const privacyWorkflowIntegration = readFileSync(
  "tests/integration/privacy-workflow.test.ts",
  "utf8",
);

function executableSqlOutsideQuotedBodies(template: string): string {
  return template
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/'(?:''|[^'])*'/g, "");
}

const preparedTemplates = [
  ...adminLedgerIntegration.matchAll(/db\.execute(?:<[^`]*?>)?\(sql`([\s\S]*?)`\)/g),
  ...privacyWorkflowIntegration.matchAll(/db\.execute(?:<[^`]*?>)?\(sql`([\s\S]*?)`\)/g),
].map((match) => match[1] ?? "");

describe("integration prepared SQL guard", () => {
  it("keeps every prepared execute template to one top-level command", () => {
    const multiCommandTemplates = preparedTemplates.filter((template) => {
      const commands = executableSqlOutsideQuotedBodies(template)
        .split(";")
        .filter((command) => command.trim().length > 0);
      return commands.length > 1;
    });

    expect(preparedTemplates.length).toBeGreaterThan(0);
    expect(multiCommandTemplates).toEqual([]);
  });

  it("binds JavaScript interpolation outside SQL string literals", () => {
    const quotedInterpolations = preparedTemplates.flatMap((template) =>
      [...template.matchAll(/'(?:''|[^'])*'/gu)]
        .map((match) => match[0])
        .filter((literal) => literal.includes("${")),
    );
    expect(quotedInterpolations).toEqual([]);
  });
});
