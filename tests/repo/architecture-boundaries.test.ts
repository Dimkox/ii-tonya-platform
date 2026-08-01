import { globSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("projection architecture boundary", () => {
  it("allows projection imports only in worker delivery composition", () => {
    const violations: string[] = [];
    for (const file of globSync(["apps/**/*.ts", "packages/**/*.ts"], {
      exclude: ["**/*.test.ts", "**/*.testkit.ts"],
    })) {
      const imports = ts
        .preProcessFile(readFileSync(file, "utf8"))
        .importedFiles.map((value) => value.fileName);
      const normalized = file.replaceAll("\\", "/");
      if (
        imports.some(
          (value) =>
            value.includes("/projections/") || value.includes("projection-port"),
        ) &&
        !normalized.startsWith("packages/worker/") &&
        normalized !== "packages/integrations/src/index.ts" &&
        !normalized.includes("packages/integrations/src/projections/")
      ) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
