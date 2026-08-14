import { describe, expect, it } from "vitest";

import { readExactAuthorization } from "./authorization-header.js";

describe("raw Authorization occurrence guard", () => {
  it("accepts exactly one case-insensitive field occurrence", () => {
    expect(readExactAuthorization(["Host", "example", "aUtHoRiZaTiOn", "Bearer x"]))
      .toBe("Bearer x");
  });

  it.each([
    [],
    ["Authorization", "Bearer a", "Authorization", "Bearer b"],
    ["authorization", "Bearer a", "AUTHORIZATION", "Bearer b"],
    ["authorization", "Bearer a,Bearer b"],
    ["authorization"],
  ])("rejects missing, duplicate, folded, or malformed raw header fields", (rawHeaders) => {
    expect(readExactAuthorization(rawHeaders)).toBeNull();
  });
});
