import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyPaymentScopeProbe,
  classifyApprovedTrackedScopeContent,
} from "./support/payment-scope-boundary.js";

const internal = "../expert-residency/verified-event-internal.js";
const mint = "mintVerifiedExpertResidencyPaymentEvent";
describe("verifier authority boundary", () => {
  it.each([
    `import { ${mint} } from "${internal}";`,
    `import { ${mint} as alias } from "${internal}";`,
    `import * as authority from "${internal}";`,
    `export * from "${internal}";`,
    `export { ${mint} as alias } from "${internal}";`,
    `const authority = await import("${internal}");`,
    `const authority = require("${internal}");`,
    `import authority = require("${internal}");`,
    `const path = "${internal}"; const authority = import(path);`,
    `const path = "${internal}"; const authority = require(path);`,
    `const path = "../expert-residency/" + "verified-event-internal.js"; import(path);`,
    'const name = "verified-event-internal"; import(`../expert-residency/${name}.js`);',
    `const path = suppliedPath; import(path);`,
    `const load = require; load("${internal}");`,
    `module.require("${internal}");`,
    `globalThis.require("${internal}");`,
    `const load = module.require; const alias = load; alias("${internal}");`,
    `const load = globalThis.require; load("${internal}");`,
    `import { createRequire } from "node:module"; createRequire(import.meta.url)("${internal}");`,
    `const load = require; const next = load; const path = "${internal}"; next(path);`,
    `import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("${internal}");`,
    `import { createRequire as factory } from "node:module"; const load = factory(import.meta.url); const alias = load; alias("${internal}");`,
    `import * as module from "node:module"; const load = module.createRequire(import.meta.url); load("${internal}");`,
    `const module = require("node:module"); const load = module.createRequire(import.meta.url); load("${internal}");`,
    `const { createRequire: factory } = require("node:module"); const load = factory(import.meta.url); load("${internal}");`,
    `function f(){ const { createRequire: factory } = require("node:module"); const load = factory(import.meta.url); return load("${internal}"); }`,
    `{ const { createRequire: factory } = require("node:module"); const load = factory(import.meta.url); load("${internal}"); }`,
    `import { ${mint} as alias } from "@ii-tonya/integrations";`,
    `export { ${mint} } from "./other.js";`,
    `import * as authority from "@ii-tonya/integrations"; authority.${mint}();`,
    `const leaked = authority["${mint}"];`,
  ])("rejects unauthorized authority access: %s", (content) => {
    expect(
      classifyPaymentScopeProbe({
        path: "apps/worker/src/neutral.ts",
        content,
      }),
    ).not.toEqual([]);
  });
  it("permits literal safe public runtime imports", () => {
    expect(
      classifyPaymentScopeProbe({
        path: "apps/worker/src/neutral.ts",
        content:
          'const path = "./neutral.js"; import(path); import("./public.js"); const load = require; load("./safe.js");',
      }),
    ).toEqual([]);
  });
  it.each([
    "scripts/verify-client-web-account-browser.mjs",
    "scripts/verify-public-client-catalog-browser.mjs",
  ])("permits only reviewed DOM harness content at %s", (path) => {
    const content = readFileSync(path, "utf8");
    expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyPaymentScopeProbe({
        path,
        content:
          content +
          '\nimport("../packages/integrations/src/expert-residency/verified-event-internal.js");',
      }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: content + "\n// changed",
      }),
    ).not.toEqual([]);
    expect(
      classifyPaymentScopeProbe({
        path: "scripts/unknown-browser.mjs",
        content,
      }),
    ).not.toEqual([]);
  });
  it("rejects public barrel exposure", () => {
    expect(
      classifyPaymentScopeProbe({
        path: "packages/integrations/src/index.ts",
        content: `export * from "./expert-residency/verified-event-internal.js";`,
      }),
    ).not.toEqual([]);
  });
  it.each([
    "packages/integrations/src/expert-residency/verified-event.ts",
    "packages/integrations/src/yookassa/verifier.ts",
  ])("permits the exact trusted importer %s", (path) => {
    const specifier = path.includes("yookassa")
      ? internal
      : "./verified-event-internal.js";
    expect(
      classifyPaymentScopeProbe({
        path,
        content: `import { ${mint} } from "${specifier}";`,
      }),
    ).toEqual([]);
  });
  it.each([
    {
      path: "packages/db/src/schema/unknown.ts",
      content: 'pgTable("payer_receipt_unknown", {});',
    },
    {
      path: "apps/api/src/routes/neutral.ts",
      content: 'app.post("/v1/expert/residency/unknown", handler);',
    },
    {
      path: "packages/integrations/src/yookassa/unknown.ts",
      content: "export {};",
    },
  ])("rejects unknown sibling $path", (probe) => {
    expect(classifyPaymentScopeProbe(probe)).not.toEqual([]);
  });
  it("rejects modified approved content", () => {
    const path = "packages/integrations/src/yookassa/operation-port.ts";
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: readFileSync(path, "utf8") + "\n// unreviewed change\n",
      }),
    ).not.toEqual([]);
  });
});
