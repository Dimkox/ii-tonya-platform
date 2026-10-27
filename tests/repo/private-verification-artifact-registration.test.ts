import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { classifyApprovedTrackedScopeContent } from "./support/payment-scope-boundary.js";

const artifacts = [
  "compose.private-parser.yaml",
  "packages/integrations/parser/Dockerfile",
  "packages/integrations/parser/build-image.sh",
  "packages/integrations/parser/socket_server.py",
  "packages/integrations/parser/test_coverage.py",
  "tests/acceptance/private-verification/make-parser-fixtures.py",
  "tests/acceptance/private-verification/sandbox-probe.py",
  "tests/acceptance/private-verification/socket-denial-probe.py",
];

it.each(artifacts)(
  "pins reviewed private parser artifact bytes: %s",
  (path) => {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
    ).not.toEqual([]);
  },
);

it.each([
  "compose.private-parser-copy.yaml",
  "packages/integrations/parser/unreviewed.py",
  "tests/acceptance/private-verification/unreviewed.py",
])("does not admit an adjacent executable: %s", (path) => {
  expect(
    classifyApprovedTrackedScopeContent({ path, content: "# unreviewed\n" }),
  ).toEqual(["unapproved executable or automation artifact path"]);
});
