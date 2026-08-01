import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  classifyApprovedTrackedScopeContent,
  classifyPaymentScopeProbe,
  isPaymentScopeInspectionPath,
  PAYMENT_SCOPE_MAX_FILE_BYTES,
  PAYMENT_SCOPE_MAX_TRACKED_FILES,
} from "./support/payment-scope-boundary.js";

describe("MVP scope boundary", () => {
  it("contains no inbound Make or Sheets Fastify route", () => {
    const violations: string[] = [];
    for (const path of globSync("apps/api/src/**/*.ts")) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          const firstArgument = node.arguments[0];
          const route = method === "route" && firstArgument && ts.isObjectLiteralExpression(firstArgument)
            ? firstArgument.properties.find(
              (property): property is ts.PropertyAssignment =>
                ts.isPropertyAssignment(property) &&
                ((ts.isIdentifier(property.name) && property.name.text === "url") ||
                  (ts.isStringLiteral(property.name) && property.name.text === "url")),
            )?.initializer
            : firstArgument;
          if (
            ["get", "post", "put", "patch", "delete", "route"].includes(method) &&
            route &&
            ts.isStringLiteral(route) &&
            /(?:make|sheets?)/iu.test(route.text)
          ) {
            violations.push(`${path}:${route.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it("contains no live or deferred commercial and scheduling modules", () => {
    const forbidden = [
      "packages/integrations/src/payment/live-payment-adapter.ts",
      "packages/domain/src/coupon.ts",
      "packages/domain/src/referral.ts",
      "packages/domain/src/reschedule.ts",
      "packages/domain/src/waitlist.ts",
    ];

    expect(forbidden.filter(existsSync)).toEqual([]);
  });

  it("keeps the payment integration directory limited to the disabled boundary", () => {
    const paymentDirectory = "packages/integrations/src/payment";
    if (!existsSync(paymentDirectory)) return;

    expect(readdirSync(paymentDirectory).sort()).toEqual([
      "disabled-payment-adapter.test.ts",
      "disabled-payment-adapter.ts",
      "payment-port.ts",
    ]);
  });

  it.each([
    [
      "Apps/API/src/routes/payments.ts",
      'fastify.post("/checkout", handler);',
    ],
    ["packages/integrations/src/commercial/gateway.ts", "export {};"],
    ["packages/integrations/src/stripe/adapter.ts", "export {};"],
    ["packages/integrations/src/yookassa-adapter.ts", "export {};"],
    ["packages/integrations/src/gateways/payment-client.ts", "export {};"],
    ["packages/integrations/src/gateways/payment-codec.ts", "export {};"],
    [
      "apps/api/src/routes/commerce.ts",
      'fastify.post("/checkout", async () => ({}));',
    ],
    [
      "apps/api/src/routes/hooks.ts",
      'fastify.post("/hooks/stripe", async () => ({}));',
    ],
    [
      "apps/api/src/routes/commerce.ts",
      "const checkoutRoutes = () => undefined; fastify.register(checkoutRoutes);",
    ],
    [
      "apps/api/src/routes/neutral.ts",
      'fastify["post"]("/checkout", handler);',
    ],
    [
      "apps/api/src/routes/neutral.ts",
      'app.use("/checkout", router);',
    ],
    [
      "packages/application/src/workers/orders.ts",
      "export class PaymentCapturedConsumer {}",
    ],
    [
      "packages/application/src/workers/orders.ts",
      "export const paymentCapturedConsumer = () => undefined;",
    ],
    [
      "packages/application/src/services/access.ts",
      "export const grantEntitlementFromPayment = () => undefined;",
    ],
    [
      "packages/application/lib/workers/orders.ts",
      "export class SettlementWorker {}",
    ],
    [
      "packages/application/src/services/access.ts",
      "export const grantAccessAfterCheckout = () => undefined;",
    ],
    [
      "packages/db/src/schema/commerce.ts",
      'export const records = pgTable("refunds", {});',
    ],
    [
      "packages/db/src/schema/neutral.ts",
      'export const records = pgTable("payment_events", {});',
    ],
    [
      "packages/db/src/schema/neutral.ts",
      'export const records = pgTable("transactions", {});',
    ],
    [
      "packages/db/migrations/001_commerce.sql",
      "CREATE TABLE charges (id uuid primary key);",
    ],
    [
      "packages/db/migrations/002_neutral.sql",
      "CREATE TABLE payment_events (id uuid primary key);",
    ],
    [
      "packages/db/migrations/meta/002_snapshot.json",
      '{"tables":{"public.payment_events":{"name":"payment_events"}}}',
    ],
    [
      "packages/integrations/src/gateways/provider.ts",
      'import Stripe from "stripe"; export { Stripe };',
    ],
    [
      "packages/integrations/lib/gateways/provider.ts",
      'export const provider = import("stripe");',
    ],
    [
      "packages/integrations/lib/gateways/provider.ts",
      'const provider = require("stripe"); export { provider };',
    ],
    [
      "packages/integrations/lib/gateways/provider.ts",
      'export const response = fetch("https://pay.invalid");',
    ],
    [
      "packages/integrations/src/index.ts",
      'import Stripe from "stripe"; export { Stripe };',
    ],
    [
      "packages/integrations/src/payment/disabled-payment-adapter.ts",
      'export const callProvider = () => fetch("https://provider.invalid");',
    ],
    [
      "packages/integrations/src/payment/payment-port.ts",
      "export class StripePaymentClient {}",
    ],
    [
      "packages/integrations/src/payment/payment-port.ts",
      "export const key = process.env.PAYMENT_API_KEY;",
    ],
    [
      "packages/integrations/src/payment/payment-port.ts",
      'export const key = process.env["PAYMENT_API_KEY"];',
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"yookassa":"1.0.0"}}',
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"@a2seven/yoo-checkout":"1.0.0"}}',
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"acme-pay":"1.0.0"}}',
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"cashier-sdk":"1.0.0"}}',
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"zod":"npm:stripe@latest"}}',
    ],
  ])("detects payment scope bypass probe %s", (path, content) => {
    expect(classifyPaymentScopeProbe({ path, content })).not.toEqual([]);
  });

  it.each([
    [
      "packages/integrations/src/payment/payment-port.ts",
      "export interface PaymentPort {}",
    ],
    [
      "packages/integrations/src/payment/disabled-payment-adapter.ts",
      'import type { PaymentPort } from "./payment-port.js";',
    ],
    [
      "packages/integrations/src/index.ts",
      'export type { PaymentPort } from "./payment/payment-port.js";',
    ],
    [
      "apps/api/src/routes/health.ts",
      "// checkout payment refund webhook are intentionally absent\nexport {};",
    ],
    [
      "packages/application/src/index.ts",
      "// payment consumer and entitlement grant are outside MVP\nexport {};",
    ],
    [
      "packages/db/src/schema/billing.ts",
      "// payment and refund tables are outside MVP\nexport {};",
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"zod":"^4.3.6"}}',
    ],
  ])("allows explicit boundaries and comment-only vocabulary in %s", (path, content) => {
    expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
  });

  it.each([
    "Apps/API/src/routes/payments.ts",
    "packages/integrations/lib/provider.ts",
    "scripts/runtime-payment-check.mjs",
    "scripts/pay.ps1",
    "scripts/maintenance.sh",
    "scripts/worker.py",
    "scripts/check.cmd",
    "scripts/check.bat",
    "scripts/check.bash",
    ".github/workflows/pay.yml",
    "Dockerfile.payment",
    "compose.yml",
  ])("inspects tracked executable source location %s", (path) => {
    expect(isPaymentScopeInspectionPath(path)).toBe(true);
  });

  it.each([
    "packages/integrations/src/index.ts",
    "packages/integrations/src/payment/payment-port.ts",
    "packages/integrations/src/payment/disabled-payment-adapter.ts",
  ])("pins exact reviewed payment boundary content for %s", (path) => {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual(
      [],
    );
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: `${content}\nexport const unexpected = true;\n`,
      }),
    ).not.toEqual([]);
  });

  it("pins exact reviewed migration and snapshot paths and content", () => {
    const approvedPath = "packages/db/migrations/0000_mvp.sql";
    const approvedContent = readFileSync(approvedPath, "utf8");
    expect(
      classifyApprovedTrackedScopeContent({
        path: approvedPath,
        content: approvedContent,
      }),
    ).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: approvedPath,
        content: `${approvedContent}\nALTER TABLE users ADD stripe_customer_id text;\n`,
      }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: "packages/db/migrations/9999_cashier.sql",
        content: "ALTER TABLE users ADD cashier_id text;",
      }),
    ).not.toEqual([]);
  });

  it.each([
    ["scripts/pay.ps1", 'Invoke-WebRequest "https://pay.invalid"'],
    ["scripts/maintenance.sh", "curl https://pay.invalid"],
    ["scripts/worker.py", 'requests.get("https://pay.invalid")'],
    [".github/workflows/pay.yml", "jobs: {}"],
    ["Dockerfile.payment", "FROM node:24"],
    ["compose.yml", "services: {}"],
  ])("rejects unapproved executable automation artifact %s", (path, content) => {
    expect(classifyApprovedTrackedScopeContent({ path, content })).not.toEqual(
      [],
    );
  });

  it("pins full package manifest content including scripts", () => {
    const path = "packages/integrations/package.json";
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);

    const manifest = JSON.parse(content) as Record<string, unknown>;
    manifest.scripts = {
      pay: 'node -e "fetch(\'https://pay.invalid\')"',
    };
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      }),
    ).not.toEqual([]);
  });

  it("pins the current approved workflow content", () => {
    const path = ".github/workflows/db-gate.yml";
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: `${content}\n# changed\n`,
      }),
    ).not.toEqual([]);
  });

  it("recursively rejects forbidden tracked production artifacts", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
    expect(tracked.length).toBeLessThanOrEqual(PAYMENT_SCOPE_MAX_TRACKED_FILES);

    const violations: string[] = [];
    for (const path of tracked.filter(isPaymentScopeInspectionPath)) {
      const size = statSync(path).size;
      if (size > PAYMENT_SCOPE_MAX_FILE_BYTES) {
        violations.push(`${path}: exceeds bounded inspection size`);
        continue;
      }
      const content = readFileSync(path, "utf8");
      for (const reason of classifyPaymentScopeProbe({
        path,
        content,
      })) {
        violations.push(`${path}: ${reason}`);
      }
      for (const reason of classifyApprovedTrackedScopeContent({
        path,
        content,
      })) {
        violations.push(`${path}: ${reason}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
