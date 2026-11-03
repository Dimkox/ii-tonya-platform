import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SCRUM-110 (TRACK-01 barrier): every HTML shell location sends one strict CSP.
const nginx = readFileSync("deploy/nginx/ii-tonya", "utf8");
const block = (head: string): string => {
  const start = nginx.indexOf(`${head} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return nginx.slice(start, nginx.indexOf("}", start));
};
const policyOf = (text: string): string[] =>
  [
    ...text.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/gu),
  ].map((match) => match[1] ?? "");

describe("public shell content security policy", () => {
  const shells = [
    "location = /admin/expert-verification",
    "location = /admin/expert-verification/",
    "location /",
  ].map(block);

  it("is present once and identical on each HTML shell location", () => {
    const policies = shells.map(policyOf);
    for (const list of policies) expect(list).toHaveLength(1);
    expect(new Set(policies.flat()).size).toBe(1);
  });

  it("allows no third-party analytics, inline code or eval", () => {
    const policy = policyOf(shells[2] ?? "")[0] ?? "";
    const directives = new Map(
      policy.split(";").map((part) => {
        const [name = "", ...values] = part.trim().split(/\s+/u);
        return [name, values] as const;
      }),
    );
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual([
      "'self'",
      "https://telegram.org",
    ]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy).not.toMatch(
      /unsafe-inline|unsafe-eval|\*|yandex|metrika|google|mail\.ru/iu,
    );
  });
});
