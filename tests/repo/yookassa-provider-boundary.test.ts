import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { classifyPaymentScopeProbe } from "./support/payment-scope-boundary.js";

it("allows network access only in the reviewed first-party YooKassa client", () => {
  expect(
    classifyPaymentScopeProbe({
      path: "packages/integrations/src/yookassa/client.ts",
      content:
        'export const request = (init: RequestInit) => fetch("https://api.yookassa.ru/v3/payments", init);',
    }),
  ).toEqual([]);

  expect(
    classifyPaymentScopeProbe({
      path: "packages/integrations/src/yookassa/escape.ts",
      content:
        'export const request = () => fetch("https://evil.invalid/pay");',
    }),
  ).not.toEqual([]);
});

it.each([
  ["yookassa", "1.0.0"],
  ["@a2seven/yoo-checkout", "1.0.0"],
  ["yoomoney-api", "github:AlekseyKorshuk/yoomoney-api"],
])("rejects provider dependency %s", (name, version) => {
  expect(
    classifyPaymentScopeProbe({
      path: "packages/integrations/package.json",
      content: JSON.stringify({ dependencies: { [name]: version } }),
    }),
  ).not.toEqual([]);
});

it("keeps credential access out of the integration module", () => {
  expect(
    classifyPaymentScopeProbe({
      path: "packages/integrations/src/yookassa/client.ts",
      content: "export const key = process.env.YOOKASSA_SECRET_KEY;",
    }),
  ).not.toEqual([]);
});

it("accepts the pinned client source without opening a generic network escape", () => {
  const path = "packages/integrations/src/yookassa/client.ts";
  expect(
    classifyPaymentScopeProbe({ path, content: readFileSync(path, "utf8") }),
  ).toEqual([]);
});
