import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findProjectionImportViolations } from "./support/projection-architecture-boundary.js";

describe("projection architecture boundary", () => {
  it("allows projection imports only in worker delivery composition", () => {
    const violations: string[] = [];
    for (const file of globSync(["apps/**/*.ts", "packages/**/*.ts"], {
      exclude: ["**/*.test.ts", "**/*.testkit.ts"],
    })) {
      violations.push(...findProjectionImportViolations({
        path: file,
        content: readFileSync(file, "utf8"),
      }));
    }
    expect(violations).toEqual([]);
  });

  it.each([
    ["direct projection import", 'import { MakeProjectionSink } from "../projections/make-projection-sink.js";'],
    ["barrel named import", 'import { MakeProjectionSink } from "@ii-tonya/integrations";'],
    ["barrel alias import", 'import { ProjectionSink as Sink } from "@ii-tonya/integrations";'],
    ["barrel namespace import", 'import * as integrations from "@ii-tonya/integrations";'],
    ["barrel re-export", 'export { ProjectionTopic as Topic } from "@ii-tonya/integrations";'],
    ["barrel namespace re-export", 'export * as integrations from "@ii-tonya/integrations";'],
    ["direct projection re-export", 'export * from "../projections/projection-port.js";'],
  ])("rejects an unauthorized %s", (_label, content) => {
    expect(findProjectionImportViolations({
      path: "apps/api/src/unauthorized.ts",
      content,
    })).not.toEqual([]);
  });

  it("allows only worker composition and the integrations public boundary", () => {
    expect(findProjectionImportViolations({
      path: "packages/worker/src/projection-delivery.ts",
      content: 'import { MakeProjectionSink } from "@ii-tonya/integrations";',
    })).toEqual([]);
    expect(findProjectionImportViolations({
      path: "packages/integrations/src/index.ts",
      content: 'export { MakeProjectionSink } from "./projections/make-projection-sink.js";',
    })).toEqual([]);
  });
});
