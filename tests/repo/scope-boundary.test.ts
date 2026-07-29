import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyPaymentScopeProbe,
  isPaymentScopeInspectionPath,
  PAYMENT_SCOPE_MAX_FILE_BYTES,
  PAYMENT_SCOPE_MAX_TRACKED_FILES,
} from "./support/payment-scope-boundary.js";

describe("MVP scope boundary", () => {
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
      "packages/db/src/schema/commerce.ts",
      'export const records = pgTable("refunds", {});',
    ],
    [
      "packages/db/migrations/001_commerce.sql",
      "CREATE TABLE charges (id uuid primary key);",
    ],
    [
      "packages/integrations/src/gateways/provider.ts",
      'import Stripe from "stripe"; export { Stripe };',
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
      "packages/integrations/package.json",
      '{"dependencies":{"yookassa":"1.0.0"}}',
    ],
    [
      "packages/integrations/package.json",
      '{"dependencies":{"@a2seven/yoo-checkout":"1.0.0"}}',
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
  ])("allows explicit boundaries and comment-only vocabulary in %s", (path, content) => {
    expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
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
      for (const reason of classifyPaymentScopeProbe({
        path,
        content: readFileSync(path, "utf8"),
      })) {
        violations.push(`${path}: ${reason}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
