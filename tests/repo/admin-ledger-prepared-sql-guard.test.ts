import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminLedgerIntegration = readFileSync(
  "tests/integration/admin-ledger.test.ts",
  "utf8",
);

function executableSqlOutsideQuotedBodies(template: string): string {
  return template
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/'(?:''|[^'])*'/g, "");
}

describe("admin ledger prepared SQL guard", () => {
  it("keeps every prepared execute template to one top-level command", () => {
    const templates = [
      ...adminLedgerIntegration.matchAll(/db\.execute(?:<[^`]*?>)?\(sql`([\s\S]*?)`\)/g),
    ].map((match) => match[1] ?? "");

    const multiCommandTemplates = templates.filter((template) => {
      const commands = executableSqlOutsideQuotedBodies(template)
        .split(";")
        .filter((command) => command.trim().length > 0);
      return commands.length > 1;
    });

    expect(templates.length).toBeGreaterThan(0);
    expect(multiCommandTemplates).toEqual([]);
  });
});
