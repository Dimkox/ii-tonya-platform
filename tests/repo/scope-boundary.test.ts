import { execFileSync } from "node:child_process";
import {
  existsSync,
  globSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPERT_RESIDENCY_ALLOWED_PATHS,
  classifyApprovedTrackedScopeContent,
  classifyPaymentScopeProbe,
  isPaymentScopeInspectionPath,
  PAYMENT_SCOPE_MAX_FILE_BYTES,
  PAYMENT_SCOPE_MAX_TRACKED_FILES,
} from "./support/payment-scope-boundary.js";
import { findProjectionCommandRouteViolations } from "./support/projection-command-route-boundary.js";

describe("MVP scope boundary", () => {
  it("contains no inbound Make or Sheets Fastify route", () => {
    const violations: string[] = [];
    for (const path of globSync("apps/api/src/**/*.ts")) {
      violations.push(
        ...findProjectionCommandRouteViolations({
          path,
          content: readFileSync(path, "utf8"),
        }),
      );
    }
    expect(violations).toEqual([]);
  });

  it.each([
    ["property route", 'app.post("/v1/webhooks/make", handler);'],
    ["element route", 'app["post"]("/v1/webhooks/sheets", handler);'],
    ["template route", "app.get(`/v1/make`, handler);"],
    ["const route", 'const route = "/v1/sheets"; app.put(route, handler);'],
    [
      "route options variable",
      'const options = { url: "/v1/make" }; app.route(options);',
    ],
    [
      "register prefix",
      'app.register(plugin, { prefix: "/v1/webhooks/sheets" });',
    ],
    [
      "FastifyInstance plugin parameter",
      'export const plugin = (fastify: FastifyInstance) => fastify.post("/v1/make", handler);',
    ],
    [
      "Fastify alias",
      'const server = app; server.post("/v1/sheets", handler);',
    ],
    [
      "named fastify import",
      'const app = fastify(); app.post("/v1/make", handler);',
    ],
    ["unknown receiver", 'router.post("/v1/webhooks/sheets", handler);'],
  ])("detects an inbound Make or Sheets %s evasion", (_label, snippet) => {
    expect(
      findProjectionCommandRouteViolations({
        path: "apps/api/src/evasion.ts",
        content: `import Fastify, { fastify, type FastifyInstance } from "fastify"; const app = Fastify(); ${snippet}`,
      }),
    ).not.toEqual([]);
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

  it("keeps the expert residency payment boundary explicitly allowlisted", () => {
    expect([...EXPERT_RESIDENCY_ALLOWED_PATHS]).toEqual(
      expect.arrayContaining([
        "packages/contracts/src/expert-residency.ts",
        "packages/integrations/src/expert-residency/payment-port.ts",
      ]),
    );
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
    ["Apps/API/src/routes/payments.ts", 'fastify.post("/checkout", handler);'],
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
    ["apps/api/src/routes/neutral.ts", 'app.use("/checkout", router);'],
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
      "apps/worker/src/sandbox-leak.ts",
      'export const leak = pgTable("sandbox_expert_residency_worker_copy", {});',
    ],
    [
      "apps/api/src/sandbox-leak.ts",
      "export const leak = sql`select * from sandbox_expert_residency_payments`;",
    ],
    [
      "packages/application/src/sandbox-leak.ts",
      'export const leak = pgTable("sandbox_expert_residency_package_copy", {});',
    ],
    [
      "packages/worker/src/sandbox-leak.ts",
      "export const leak = sql`delete from sandbox_expert_residency_events`;",
    ],
    [
      "packages/worker/migrations/0001_sandbox_leak.sql",
      "create table sandbox_expert_residency_migration_copy (id uuid primary key);",
    ],
  ])("rejects sandbox relation escape probe %s", (path, content) => {
    expect(isPaymentScopeInspectionPath(path)).toBe(true);
    expect(classifyPaymentScopeProbe({ path, content })).toContain(
      "sandbox relation token outside approved sandbox paths",
    );
  });

  it.each([
    [
      "packages/sandbox-payments/src/schema.ts",
      'export const leak = pgTable("sandbox_expert_residency_shadow", {});',
    ],
    [
      "packages/sandbox-payments/src/repository.ts",
      "export const leak = sql`select * from sandbox_expert_residency_shadow`;",
    ],
  ])(
    "rejects unknown sandbox relation in approved source %s",
    (path, content) => {
      expect(classifyPaymentScopeProbe({ path, content })).toContain(
        "unknown sandbox relation in approved sandbox source: sandbox_expert_residency_shadow",
      );
    },
  );

  it.each([
    "docs/sandbox-payment-boundary.md",
    "tests/repo/sandbox-payment-evidence.test.ts",
    ".superpowers/sdd/task-1-report.md",
    ".agents/skills/bmad-review/scripts/word_metrics.py",
    "_bmad/scripts/render_skill.py",
  ])("does not inspect documentation, tests, or evidence at %s", (path) => {
    expect(isPaymentScopeInspectionPath(path)).toBe(false);
  });

  it.each([
    "scripts/bmad-payment.py",
    ".agents/skills/not-bmad/scripts/payment.py",
  ])("keeps non-vendored executable lookalikes in scope at %s", (path) => {
    expect(isPaymentScopeInspectionPath(path)).toBe(true);
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
    ["packages/integrations/package.json", '{"dependencies":{"zod":"^4.3.6"}}'],
  ])(
    "allows explicit boundaries and comment-only vocabulary in %s",
    (path, content) => {
      expect(classifyPaymentScopeProbe({ path, content })).toEqual([]);
    },
  );

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
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
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
    "packages/db/migrations/0009_young_arachne.sql",
    "packages/db/migrations/0016_task17c_admin_workflows.sql",
    "packages/db/migrations/meta/0016_snapshot.json",
    "packages/db/migrations/0017_adorable_sinister_six.sql",
    "packages/db/migrations/meta/0017_snapshot.json",
    "packages/db/migrations/0019_expert_order_provider_deadline.sql",
    "packages/db/migrations/0021_expert_settlement_snapshot.sql",
    "packages/db/migrations/0022_expert_referral_admin_replays.sql",
    "packages/db/migrations/0033_expert_referral_maturity_a2.sql",
    "packages/db/migrations/0034_hybrid_message_gateway_b1.sql",
    "packages/db/migrations/0035_hybrid_message_gateway_b2.sql",
    "packages/db/migrations/0036_selarti_budget_controls_b3.sql",
    "packages/db/migrations/0037_partner_commerce_a.sql",
    "packages/db/migrations/0038_test_expert_trial.sql",
    "packages/db/migrations/meta/0021_snapshot.json",
    "packages/db/migrations/meta/_journal.json",
  ])("pins approved post-MVP migration content for %s", (path) => {
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: `${content}\n-- unexpected\n`,
      }),
    ).not.toEqual([]);
  });

  it.each([
    [
      "expert_residency.tariff_create_v3",
      "packages/db/src/repositories/expert-referral-admin-repository.ts",
      'action: "expert_residency.tariff_create_v3"',
    ],
    [
      "client_commercial_policy_assignments_shadow",
      "packages/db/src/schema/commercial-policy.ts",
      'pgTable("client_commercial_policy_assignments_shadow", {})',
    ],
    [
      "packages/db/migrations/0032_commercial_core_v2_a1.sql.bak",
      "packages/db/migrations/0032_commercial_core_v2_a1.sql.bak",
      'import Stripe from "stripe";',
    ],
  ])("rejects near-miss A1 scope entry %s", (_nearMiss, path, content) => {
    expect([
      ...classifyPaymentScopeProbe({ path, content }),
      ...classifyApprovedTrackedScopeContent({ path, content }),
    ]).not.toEqual([]);
  });

  it.each([
    "packages/db/src/schema/audit.ts",
    "packages/db/src/schema/identity.ts",
    "packages/db/src/schema/expert-residency.ts",
    "packages/db/src/schema/integration.ts",
  ])("allows reviewed non-payment relations in %s", (path) => {
    expect(
      classifyPaymentScopeProbe({
        path,
        content: readFileSync(path, "utf8"),
      }),
    ).toEqual([]);
  });

  it.each([
    ["scripts/pay.ps1", 'Invoke-WebRequest "https://pay.invalid"'],
    ["scripts/maintenance.sh", "curl https://pay.invalid"],
    ["scripts/worker.py", 'requests.get("https://pay.invalid")'],
    [".github/workflows/pay.yml", "jobs: {}"],
    ["Dockerfile.payment", "FROM node:24"],
    ["compose.yml", "services: {}"],
  ])(
    "rejects unapproved executable automation artifact %s",
    (path, content) => {
      expect(
        classifyApprovedTrackedScopeContent({ path, content }),
      ).not.toEqual([]);
    },
  );

  it("pins full package manifest content including scripts", () => {
    const path = "packages/integrations/package.json";
    const content = readFileSync(path, "utf8");
    expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual([]);

    const manifest = JSON.parse(content) as Record<string, unknown>;
    manifest.scripts = {
      pay: "node -e \"fetch('https://pay.invalid')\"",
    };
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: `${JSON.stringify(manifest, null, 2)}\n`,
      }),
    ).not.toEqual([]);
  });

  it("rejects GitHub Actions as unapproved executable automation", () => {
    const path = ".github/workflows/db-gate.yml";
    const content = "jobs: {}\n";
    expect(classifyApprovedTrackedScopeContent({ path, content })).not.toEqual(
      [],
    );
    expect(
      classifyApprovedTrackedScopeContent({
        path,
        content: `${content}\n# changed\n`,
      }),
    ).not.toEqual([]);
  });

  it("keeps deterministic database clocks outside the production API", () => {
    const repository = readFileSync(
      "packages/db/src/repositories/admin-repository.ts",
      "utf8",
    );
    const publicIndex = readFileSync("packages/db/src/index.ts", "utf8");
    const testkit = readFileSync(
      "packages/db/src/testkit/admin-repository.ts",
      "utf8",
    );
    expect(repository).not.toContain("testOnlyNow");
    expect(repository).toContain("private grantClock()");
    expect(repository).not.toContain("protected grantClock()");
    expect(publicIndex).not.toContain("createTestClockAdminRepository");
    expect(publicIndex).not.toContain("TestClockAdminRepository");
    expect(testkit).toContain("createTestClockAdminRepository");
  });

  it.each(["Dockerfile", "compose.yaml", "scripts/validate-runtime-env.sh"])(
    "pins reviewed Task21/22/23 release automation content for %s",
    (path) => {
      const content = readFileSync(path, "utf8");
      expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual(
        [],
      );
      expect(
        classifyApprovedTrackedScopeContent({
          path,
          content: `${content}\n# unreviewed mutation\n`,
        }),
      ).not.toEqual([]);
    },
  );

  it("recursively rejects forbidden tracked production artifacts", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
    expect(tracked.length).toBeLessThanOrEqual(PAYMENT_SCOPE_MAX_TRACKED_FILES);

    const violations: string[] = [];
    for (const path of tracked.filter(
      (candidate) =>
        existsSync(candidate) && isPaymentScopeInspectionPath(candidate),
    )) {
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
  }, 30_000);
});

describe("residency offer correction registration", () => {
  it.each([
    "packages/db/migrations/0056_residency_offer_corrections.sql",
    "packages/db/migrations/meta/0056_snapshot.json",
    "packages/db/migrations/state/0056_offer_sql_objects.json",
  ])(
    "pins the reviewed correction artifact and rejects changed bytes: %s",
    (path) => {
      const content = readFileSync(path, "utf8");
      expect(classifyApprovedTrackedScopeContent({ path, content })).toEqual(
        [],
      );
      expect(
        classifyApprovedTrackedScopeContent({ path, content: content + "\n" }),
      ).not.toEqual([]);
    },
  );
  it.each([
    "/v1/admin/expert-verification/:applicationId/profile-verification",
    "/v1/admin/expert-verification/telegram-pairing",
    "/v1/webhooks/telegram/expert-manager/:botKey",
  ])("allows only the exact reviewed manager route: %s", (route) => {
    const path = "apps/api/src/routes/neutral.ts";
    expect(
      classifyPaymentScopeProbe({
        path,
        content: `app.post(${JSON.stringify(route)}, handler);`,
      }),
    ).toEqual([]);
    const shadow = route + "/unsafe";
    expect(
      classifyPaymentScopeProbe({
        path,
        content: `app.post(${JSON.stringify(shadow)}, handler);`,
      }),
    ).toContain(`unapproved expert residency API route: ${shadow}`);
  });
  it("rejects an unreviewed correction relation or migration lookalike", () => {
    expect(
      classifyPaymentScopeProbe({
        path: "packages/db/src/schema/neutral.ts",
        content: 'export const x=pgTable("expert_offer_profiles_shadow",{});',
      }),
    ).not.toEqual([]);
    expect(
      classifyApprovedTrackedScopeContent({
        path: "packages/db/migrations/0056_residency_offer_corrections_shadow.sql",
        content: "CREATE TABLE expert_offer_profiles(id uuid);",
      }),
    ).not.toEqual([]);
  });
});
