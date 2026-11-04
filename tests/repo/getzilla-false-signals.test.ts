import { describe, expect, it } from "vitest";
// @ts-expect-error untyped repository script
import { causes } from "../../scripts/reproduce-getzilla-false-signals.mjs";

const SUFFIXES = [".gz", ".zip", ".so"];
const regular = new Set(["100644"]);

describe("reproduce-getzilla-false-signals causes()", () => {
  it("mirrors each engine 2.3.1 branch that turns a binary into an inventory gap", () => {
    expect(causes("docs/a.log.gz", regular, SUFFIXES)).toEqual([
      "archive-or-executable-suffix",
    ]);
    expect(causes("bin/tool", regular, SUFFIXES)).toEqual([
      "extensionless-name",
    ]);
    expect(causes("a.dat", new Set(["100755"]), SUFFIXES)).toEqual([
      "executable-mode",
    ]);
    expect(causes("a.dat", new Set(["120000"]), SUFFIXES)).toEqual([
      "non-regular-mode",
    ]);
  });

  it("leaves a plain regular binary to the non-blocking BINARY_FILE reason", () => {
    expect(causes("apps/web/public/favicon.png", regular, SUFFIXES)).toEqual(
      [],
    );
  });
});
