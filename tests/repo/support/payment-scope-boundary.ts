import { createHash } from "node:crypto";
import * as ts from "typescript";

export const PAYMENT_SCOPE_MAX_TRACKED_FILES = 5_000;
export const PAYMENT_SCOPE_MAX_FILE_BYTES = 1_048_576;

export const EXPERT_RESIDENCY_ALLOWED_PATHS = new Set([
  "packages/contracts/src/expert-residency.ts",
  "packages/integrations/src/expert-residency/payment-port.ts",
  "packages/integrations/src/expert-residency/disabled-payment-adapter.ts",
  "packages/integrations/src/expert-residency/verified-event.ts",
  "packages/integrations/src/expert-residency/environment-secret-resolver.ts",
]);

export const EXPERT_RESIDENCY_ALLOWED_MIGRATION_PATHS = new Set([
  "packages/db/migrations/0018_expert_residency_referrals.sql",
  "packages/db/migrations/meta/0018_snapshot.json",
  "packages/db/migrations/meta/_journal.json",
]);

export const EXPERT_RESIDENCY_ALLOWED_RELATIONS = new Set([
  "expert_referral_code_batches",
  "expert_referral_codes",
  "expert_referrals",
  "expert_residency_tariff_versions",
  "expert_residency_orders",
  "expert_residency_payment_attempts",
  "expert_residency_provider_event_inbox",
  "expert_first_residency_settlements",
  "expert_referral_reward_grants",
  "expert_referral_ledger_entries",
  "expert_referral_ledger_allocations",
  "expert_referral_issuance_overrides",
  "expert_referral_abuse_holds",
  "expert_referral_feature_controls",
  "expert_referral_balances",
]);

export const EXPERT_RESIDENCY_ALLOWED_ROUTES = new Set([
  "/v1/expert/referrals/redeem",
  "/v1/expert/referrals/summary",
  "/v1/expert/residency/quotes",
  "/v1/expert/residency/checkouts",
  "/v1/admin/expert-referrals/inventory",
]);

export const EXPERT_RESIDENCY_ALLOWED_FLAGS = new Set([
  "EXPERT_REFERRAL_ENABLED",
  "EXPERT_RESIDENCY_BILLING_ENABLED",
  "EXPERT_REFERRAL_HMAC_KEY_VERSION",
  "EXPERT_REFERRAL_HMAC_KEY_REF",
  "EXPERT_REFERRAL_HMAC_KEYS_JSON",
]);

export const EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS = new Set([
  "expert_referral.batch_generate",
  "expert_referral.code_revoke",
  "expert_referral.issuance_override",
  "expert_referral.abuse_hold_open",
  "expert_referral.abuse_hold_close",
  "expert_referral.hold_replay",
  "expert_referral.feature_switch",
  "expert_residency.tariff_create",
  "expert_residency.tariff_retire",
]);

const approvedPaymentBoundaryPaths = new Set([
  "packages/integrations/src/index.ts",
  "packages/integrations/src/payment/disabled-payment-adapter.ts",
  "packages/integrations/src/payment/payment-port.ts",
]);
const approvedPaymentBoundaryHashes = new Map([
  [
    "packages/integrations/src/index.ts",
    "aae290c279d85d85ae90714b6526e8cda4fba070632b188d567302bfa7062c43",
  ],
  [
    "packages/integrations/src/payment/disabled-payment-adapter.ts",
    "1ae27257231b3b3060219eb400936ebc37b251a95969f047bc450e5050c7560f",
  ],
  [
    "packages/integrations/src/payment/payment-port.ts",
    "84dc621fc5cafdffb64cb42af0fa567cad6560ea41ea46ce393d8aa29cce950f",
  ],
]);
const approvedPackageManifestHashes = new Map([
  [
    "apps/api/package.json",
    "34edd6b480799b53b8e378fa596586ff3406adb945ef1c48910150bcc55e8449",
  ],
  [
    "apps/worker/package.json",
    "e339e6554bbd2d083f0e0d14f5c4893c4e57c719422ccbb29f807fea058eec72",
  ],
  [
    "package.json",
    "72663e3c3fec8213589133841b9f10cd39ee1a7cefe00967fa279befa1deb891",
  ],
  [
    "packages/application/package.json",
    "507dfff15d9c8b52a4fa3a30f97219c839921cee18ff2661ac15fb6bdbfcfe89",
  ],
  [
    "packages/config/package.json",
    "9aa5f2e8fa0c82f1f5ea18020537a8fa76c9416e01eb91fe9819948c65a65467",
  ],
  [
    "packages/contracts/package.json",
    "3d58ef391e2b36da2a0ea5a5e19f9fb576fb555c12e97cfc4c84daa6948b62cf",
  ],
  [
    "packages/db/package.json",
    "a353472305685ce82b891a6dfc7eff4a015d9f4cc376191fde47ec6b89fb155a",
  ],
  [
    "packages/domain/package.json",
    "79fc6070f4c1c2936b79c20e4635dc980c78742d66ca270340054d1e9e6265f8",
  ],
  [
    "packages/integrations/package.json",
    "24ff853ea1e3e9f6d810cccf2ed57bb6ab8a599fe9a0495ac5143f961996494c",
  ],
  [
    "packages/observability/package.json",
    "74a51f0c482a51b47f47a765619a1ddf35e9e8c1ff4ab1997507663e61f38f0f",
  ],
  [
    "packages/worker/package.json",
    "da18d8b8bbfa95815d8d9bfae9a2de15125c8bd91e2c84be1e4de73706fa8cd7",
  ],
]);
const approvedAutomationArtifactHashes = new Map([
  [
    ".github/workflows/ci.yml",
    "9f2991da5e1a5721953b467d585a87dbee14a865f98f2481060a09d6c68150fb",
  ],
  [
    ".github/workflows/db-gate.yml",
    "e4d0009d9c9af5b053478a0070adfddf08a2f49df6bec365a92d91f52a673811",
  ],
  [
    ".github/workflows/release.yml",
    "547acbd9a8121c53641636512fe7f7048ec57c448332bd190d84090d06658953",
  ],
  [
    "deploy/compose.remote.yml",
    "770925eae581bbd1fea73d4d52e526cbf26d7c28cfa241585b29ae38c37d4f17",
  ],
  [
    "scripts/deploy-compose-remote.sh",
    "3448eb38e5b561534bfdfda3d8edc0af58becf271cd0899a3b6d93fbe58a4f7e",
  ],
  [
    "scripts/validate-runtime-env.sh",
    "fd44cf8a73a6e8e8403d49b0415696b38b756e051da3533775c25cca92b35a40",
  ],
  [
    "dockerfile",
    "264dac837c1b3b81f07605b825be994f8ce7a1c7865eb243ced4ec81b3e3baca",
  ],
  [
    "compose.yaml",
    "dbb4863e1bf51df3bc655aec6a6381ba5b9d41c6480ab1c2455f15440200ac15",
  ],
]);
const approvedPackageDependencies = new Map<string, ReadonlySet<string>>([
  [
    "apps/api/package.json",
    new Set([
      "@fastify/rate-limit",
      "@ii-tonya/application",
      "@ii-tonya/config",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/observability",
      "fastify",
    ]),
  ],
  [
    "apps/worker/package.json",
    new Set([
      "@ii-tonya/config",
      "@ii-tonya/db",
      "@ii-tonya/integrations",
      "@ii-tonya/observability",
      "@ii-tonya/worker",
    ]),
  ],
  [
    "package.json",
    new Set([
      "@eslint/js",
      "@types/node",
      "@vitest/coverage-v8",
      "drizzle-kit",
      "drizzle-orm",
      "eslint",
      "globals",
      "prettier",
      "tsup",
      "tsx",
      "typescript",
      "typescript-eslint",
      "vitest",
      "yaml",
    ]),
  ],
  [
    "packages/application/package.json",
    new Set(["@ii-tonya/contracts", "@ii-tonya/domain"]),
  ],
  ["packages/config/package.json", new Set(["zod"])],
  ["packages/contracts/package.json", new Set(["zod"])],
  [
    "packages/db/package.json",
    new Set([
      "@ii-tonya/contracts",
      "@ii-tonya/domain",
      "@testcontainers/postgresql",
      "@types/pg",
      "drizzle-kit",
      "drizzle-orm",
      "pg",
    ]),
  ],
  ["packages/domain/package.json", new Set(["fast-check"])],
  [
    "packages/integrations/package.json",
    new Set(["@ii-tonya/contracts", "zod"]),
  ],
  [
    "packages/observability/package.json",
    new Set(["@opentelemetry/api", "@opentelemetry/sdk-node", "pino"]),
  ],
  [
    "packages/worker/package.json",
    new Set([
      "@ii-tonya/application",
      "@ii-tonya/contracts",
      "@ii-tonya/db",
      "@ii-tonya/domain",
      "@ii-tonya/integrations",
    ]),
  ],
]);
const approvedDependencySpecifiers = new Map([
  ["@eslint/js", "^9.31.0"],
  ["@fastify/rate-limit", "^10.3.0"],
  ["@ii-tonya/application", "workspace:*"],
  ["@ii-tonya/config", "workspace:*"],
  ["@ii-tonya/contracts", "workspace:*"],
  ["@ii-tonya/db", "workspace:*"],
  ["@ii-tonya/domain", "workspace:*"],
  ["@ii-tonya/integrations", "workspace:*"],
  ["@ii-tonya/observability", "workspace:*"],
  ["@ii-tonya/worker", "workspace:*"],
  ["@opentelemetry/api", "^1.9.0"],
  ["@opentelemetry/sdk-node", "^0.221.0"],
  ["@testcontainers/postgresql", "^10.28.0"],
  ["@types/node", "^24.0.0"],
  ["@types/pg", "^8.15.5"],
  ["@vitest/coverage-v8", "^3.2.4"],
  ["drizzle-kit", "^0.31.4"],
  ["drizzle-orm", "^0.45.2"],
  ["eslint", "^9.31.0"],
  ["fast-check", "^4.2.0"],
  ["fastify", "^5.5.0"],
  ["globals", "^14.0.0"],
  ["pg", "^8.16.3"],
  ["pino", "^9.7.0"],
  ["prettier", "^3.6.2"],
  ["tsup", "^8.5.0"],
  ["tsx", "^4.20.3"],
  ["typescript", "^5.8.3"],
  ["typescript-eslint", "^8.30.1"],
  ["vitest", "^3.2.4"],
  ["yaml", "^2.8.0"],
  ["zod", "^4.3.6"],
]);
const approvedMigrationHashes = new Map([
  [
    "packages/db/migrations/0000_mvp.sql",
    "067926dd1249fabdc59f91dedd39ebfade05a55a3de38059705092f512139216",
  ],
  [
    "packages/db/migrations/0001_message-package-metadata.sql",
    "eb09df658b46f735c4dbaedf899c8b4b87ac77649655842666cdd3ab2972c6a2",
  ],
  [
    "packages/db/migrations/0002_atomic-message-accounting.sql",
    "d29a4db9cd25d98cf9b586e2d64e8094fbd8ccbf4a41fe2b2c3752843b5ffea5",
  ],
  [
    "packages/db/migrations/0003_booking-concurrency.sql",
    "c070a7696279f3379ade453e4291626aae6e81bc21162c7bc0d628435131bbcd",
  ],
  [
    "packages/db/migrations/0004_durable_outbox.sql",
    "e2a2292c1401e0e5b19f4d7cf2adfd79a37391fe7854049cc3c4a883777794ab",
  ],
  [
    "packages/db/migrations/0005_outbox_fencing_tokens.sql",
    "d726342f962f66f975e7350ec1a3dadb78eac6d32349a0c09932bf56d5edcb4d",
  ],
  [
    "packages/db/migrations/0006_telegram-callback-expert-fk.sql",
    "551998e8ae51fe5d2267ca2dc4d13e54d8af05f084bcfd8cb92a63f0ba3d1567",
  ],
  [
    "packages/db/migrations/0007_catalog-eligibility-fields.sql",
    "cd056b56578fd09915da44e99bb63f025757c2561bfb0391a327107680748303",
  ],
  [
    "packages/db/migrations/0008_booking-expert-view.sql",
    "d08810977e9e8fef657e60147627a7c078ff91929626d4e2cd52a083f0bef840",
  ],
  [
    "packages/db/migrations/0009_young_arachne.sql",
    "4ffb0a9a5746c46873fed26adeac21865b02c3bac50a22bf8cf96b6a00c99f34",
  ],
  [
    "packages/db/migrations/0010_brown_purifiers.sql",
    "b00006d3b168a7b1295e7da6028756e3fd8dda5f13310765c54484fd205b8da0",
  ],
  [
    "packages/db/migrations/0011_sad_red_ghost.sql",
    "e51142adf199100404453875cff4088614019eb126805d28ce2922fe114b1bf7",
  ],
  [
    "packages/db/migrations/0012_productive_siren.sql",
    "12fe46e565320459cccb9c23f7637b1a34ccb4407fef3ad25fc767cfa5ca6851",
  ],
  [
    "packages/db/migrations/0013_gorgeous_deathstrike.sql",
    "2e7d88b34ca12b010c18ca722cddad2323c7a60dbb0c56db408d8db5d5d292c2",
  ],
  [
    "packages/db/migrations/0014_admin_feedback_controls.sql",
    "b1b36ae08655a70398b0133e38bbb1442a6bc0ea37f75a78c1e5b01808e67339",
  ],
  [
    "packages/db/migrations/0015_admin_iam.sql",
    "c84622593e18513feae28abf47d82f52bf2bb77f54a50e77d4d5c353cda1aabc",
  ],
  [
    "packages/db/migrations/0016_task17c_admin_workflows.sql",
    "3fb0532ce45de66c4d1f86c74aaf473e525d9440e6937d716ed50dc3e93e9045",
  ],
  [
    "packages/db/migrations/0017_adorable_sinister_six.sql",
    "255b88191d6bdfc679ea5066b247c47ad19fca41832baace209db424736972fa",
  ],
  [
    "packages/db/migrations/0018_expert_residency_referrals.sql",
    "73b2f47b8bdcdb8f541fe169aa6d5cf6f3787c293b9d8d96344e1831e1bf522a",
  ],
  [
    "packages/db/migrations/meta/0000_snapshot.json",
    "a14d4d2de4fb32d36e2e84e55ad57e8f3cee59dad903adb6f68036ac6b54b8a8",
  ],
  [
    "packages/db/migrations/meta/0001_snapshot.json",
    "8e2d5febb23b7017ecf0de19acb4b7207d32e47ddd66af72586b030a4146f71b",
  ],
  [
    "packages/db/migrations/meta/0002_snapshot.json",
    "0af1d4abb7f505136cbd36239d6fcb2a44de9bd479f613f8aa2b9a663506c7e8",
  ],
  [
    "packages/db/migrations/meta/0003_snapshot.json",
    "d4682f177711765f3a54f7018657617657470efc18aa8b4e74fcf0cf0e9ddc68",
  ],
  [
    "packages/db/migrations/meta/0004_snapshot.json",
    "64f8c016d7f457ae75744666880efda6c2e30f8554d4a36844d0dd418bc22ae0",
  ],
  [
    "packages/db/migrations/meta/0005_snapshot.json",
    "c4f244df4c1ab894d37522cf0bb140cadb262124c17bfeee4b5570a29bd9dbc8",
  ],
  [
    "packages/db/migrations/meta/0006_snapshot.json",
    "3feec1d2443b1ae9e6b8e6d03fb41a7fb6d6ee0995adfd63650cfc062d487df5",
  ],
  [
    "packages/db/migrations/meta/0007_snapshot.json",
    "4c589a340cdd27dde006965ebe4abcb35e3ef5d81f2e564ad34385d99e1b115e",
  ],
  [
    "packages/db/migrations/meta/0008_snapshot.json",
    "70a79a380f0cd1476b9630700cca47dae309e4441ad37fb8ca38ae6c9c8c9b3a",
  ],
  [
    "packages/db/migrations/meta/0009_snapshot.json",
    "9baef30564ea5f3ac9b4fce898a8290e625bba601bfaf1a87bc25a44ad208e59",
  ],
  [
    "packages/db/migrations/meta/0010_snapshot.json",
    "3ed7aec9d82f66e55c47fcb644dc04816d94c05a74a4dabd71fe749683eae0a8",
  ],
  [
    "packages/db/migrations/meta/0011_snapshot.json",
    "06c3b7b0aec9f3acfd260ac6f0d4ca261ddb41c2ed45993577c0b8753dbdc6e6",
  ],
  [
    "packages/db/migrations/meta/0012_snapshot.json",
    "f8ceccd525ca144dd160976b487acd41116ffcfde65ff630d92003928a49b045",
  ],
  [
    "packages/db/migrations/meta/0013_snapshot.json",
    "162528fc521552603321ee76c0cce5afa8ea558ace356f3fd0b69065ba511923",
  ],
  [
    "packages/db/migrations/meta/0015_snapshot.json",
    "201253c5d75b93fb1e3b483d91e4dbc2cedeab93912f029b681a92ea3cb82ebb",
  ],
  [
    "packages/db/migrations/meta/0016_snapshot.json",
    "e1b95f18854218f2a1e9376d03988e132f8bed6ea5f7969321a3e3be4566d9ef",
  ],
  [
    "packages/db/migrations/meta/0017_snapshot.json",
    "42dd577fe90276a165e03294701ea22ad799cfdd5e631e69d94b5008a9bcb903",
  ],
  [
    "packages/db/migrations/meta/0018_snapshot.json",
    "f3c693f5e3c21fdc66681f764ddf0c9225e0503ff4baf69ae03d966cd4eba73b",
  ],
  [
    "packages/db/migrations/meta/_journal.json",
    "173d7f69f4d984db473b802ff7a73360f944ceaa312a8415579dab04094b7573",
  ],
]);
const approvedDatabaseRelations = new Set([
  "admin_case_actions",
  "admin_approvals",
  "admin_object_assignments",
  "admin_role_assignments",
  "admin_sessions",
  "audit_events",
  "channel_identities",
  "client_profiles",
  "consents",
  "conversation_messages",
  "conversations",
  "dead_letters",
  "delivery_attempts",
  "expert_services",
  "experts",
  "feedback",
  "human_escalations",
  "integration_errors",
  "integration_inbox",
  "integration_outbox",
  "message_events",
  "message_ledger_entries",
  "message_packages",
  "notifications",
  "outbox_operator_alerts",
  "package_balances",
  "privacy_deletion_jobs",
  "privacy_deletion_manifests",
  "privacy_processor_attempts",
  "privacy_retention_items",
  "projection_checkpoints",
  "prompt_versions",
  "provider_cursors",
  "provider_subject_mappings",
  "reconciliation_mismatches",
  "reconciliation_runs",
  "reservations",
  "safety_incidents",
  "slots",
  "users",
  "webhook_inbox",
  ...EXPERT_RESIDENCY_ALLOWED_RELATIONS,
]);

const forbiddenProviderContent =
  /\b(fetch|axios|stripe|yookassa|PAYMENT_API_KEY)\b/u;

const providerName =
  /^(?:@stripe\/|stripe(?:\/|$)|@yookassa\/|yookassa(?:\/|$)|@a2seven\/yoo-checkout(?:\/|$)|cloudpayments(?:\/|$)|paypal(?:\/|$)|@paypal\/|adyen(?:\/|$)|@adyen\/|square(?:\/|$)|@square\/)/iu;
const commercialDependencySegments = new Set([
  "billing",
  "checkout",
  "commerce",
  "merchant",
  "pay",
  "payment",
  "payments",
]);
const providerPath =
  /(?:^|\/)(?:commercial|commerce|stripe|yookassa|cloudpayments|paypal|adyen|square)(?:[-_.\/]|$)/iu;
const paymentIntegrationArtifact =
  /(?:^|\/)payments?(?:[-_](?:adapter|client|codec|gateway|provider|service))?(?:[-_.\/]|$)/iu;
const paymentApiPath = /(?:^|\/)(?:checkout|payments?|refunds?)(?:[-_.\/]|$)/iu;
const paymentApplicationPath =
  /(?:^|\/)(?:payments?(?:[-_].*)?|.*payment[-_](?:consumer|handler)|entitlement[-_]grant|settlement[-_]worker|checkout[-_].*(?:access|entitlement|grant))(?:[-_.\/]|$)/iu;
const paymentDbPath = /(?:^|\/)(?:payments?|refunds?|charges?)(?:[-_.\/]|$)/iu;
const commercialRoute =
  /\/(?:checkout|payments?|refunds?|stripe|yookassa)(?:\/|$)/iu;
const paymentApplicationIdentifier =
  /^(?:Payment\w*Consumer|\w*PaymentConsumer|grant\w*Entitlement\w*Payment|grant\w*Payment\w*Entitlement|Payment\w*EntitlementGrant|(?:Payment|Checkout|Refund)\w*Routes?)$/iu;
const paymentApiIdentifier =
  /^(?:payment|checkout|refund|stripe|yookassa)\w*Routes?$/iu;
const expertResidencyRoute = /^\/v1\/(?:admin\/)?expert(?:-|\/)/u;
const expertResidencyFlag = /^EXPERT_(?:REFERRAL|RESIDENCY)_/u;
const expertResidencyAdminAction = /^(?:expert_referral|expert_residency)\./u;
const prohibitedCouponOrReferralModel =
  /(?:^|\/)(?:client-)?(?:coupon|referral)(?:[-_.\/]|$)/iu;

export interface PaymentScopeProbe {
  readonly path: string;
  readonly content: string;
}

const normalizePath = (path: string): string =>
  path.replaceAll("\\", "/").toLowerCase();

const isTestSource = (path: string): boolean =>
  /(?:^|\/)tests?\//u.test(path) ||
  /\.(?:test|spec|testkit)\.[cm]?[jt]sx?$/u.test(path);

const isExecutableAutomationPath = (path: string): boolean =>
  /\.(?:ps1|sh|bash|py|cmd|bat)$/u.test(path) ||
  /^\.github\/workflows\/.+\.(?:yml|yaml)$/u.test(path) ||
  /(?:^|\/)dockerfile(?:[._-].*)?$/u.test(path) ||
  /(?:^|\/)(?:docker-)?compose(?:\.[^/]+)?\.(?:yml|yaml)$/u.test(path);

export const isPaymentScopeInspectionPath = (rawPath: string): boolean => {
  const path = normalizePath(rawPath);
  if (path.endsWith("/package.json") || path === "package.json") return true;
  if (/^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path)) {
    return true;
  }
  if (isExecutableAutomationPath(path)) return true;
  return /\.[cm]?[jt]sx?$/u.test(path) && !isTestSource(path);
};

const hasCommercialDependencySegment = (value: string): boolean =>
  providerName.test(value) ||
  value
    .toLowerCase()
    .split(/[@/_-]+/u)
    .some((segment) => commercialDependencySegments.has(segment));

const isCommercialProviderSpecifier = (value: string): boolean =>
  !value.startsWith(".") && hasCommercialDependencySegment(value);

const literalText = (node: ts.Expression | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const callMethodName = (
  expression: ts.LeftHandSideExpression,
): string | undefined => {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    return literalText(expression.argumentExpression);
  }
  return undefined;
};

const routeFromCall = (node: ts.CallExpression): string | undefined => {
  const method = callMethodName(node.expression);
  if (!method) return undefined;
  if (["get", "post", "put", "patch", "delete", "use"].includes(method)) {
    return literalText(node.arguments[0]);
  }
  if (method !== "route") return undefined;
  const options = node.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === "url") ||
        (ts.isStringLiteral(property.name) && property.name.text === "url"))
    ) {
      return literalText(property.initializer);
    }
  }
  return undefined;
};

const isApprovedPaymentBoundaryImport = (
  path: string,
  specifier: string,
): boolean =>
  (path === "packages/integrations/src/index.ts" &&
    [
      "./payment/disabled-payment-adapter.js",
      "./payment/payment-port.js",
      "./projections/make-projection-sink.js",
      "./projections/projection-port.js",
    ].includes(specifier)) ||
  (path === "packages/integrations/src/payment/disabled-payment-adapter.ts" &&
    specifier === "./payment-port.js") ||
  (path ===
    "packages/integrations/src/expert-residency/disabled-payment-adapter.ts" &&
    specifier === "./payment-port.js");

const isNetworkCall = (node: ts.CallExpression): boolean => {
  if (ts.isIdentifier(node.expression)) {
    return /^(?:fetch|request)$/u.test(node.expression.text);
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = node.expression.expression;
  return (
    ts.isIdentifier(owner) && /^(?:axios|http|https|undici)$/u.test(owner.text)
  );
};

const moduleSpecifierFromCall = (
  node: ts.CallExpression,
): string | undefined => {
  if (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require")
  ) {
    return literalText(node.arguments[0]);
  }
  return undefined;
};

const processEnvKey = (
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | undefined => {
  const expression = node.expression;
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== "process" ||
    expression.name.text !== "env"
  ) {
    return undefined;
  }
  return ts.isPropertyAccessExpression(node)
    ? node.name.text
    : literalText(node.argumentExpression);
};

const isPaymentCredentialKey = (key: string): boolean =>
  /^PAYMENTS?_(?:API_?KEY|TOKEN|SECRET|WEBHOOK_SECRET|BASE_URL|PROVIDER)$/u.test(
    key,
  );

const isCommercialNetworkTarget = (target: string): boolean =>
  /(?:^|[/:._-])(?:pay|payment|payments|checkout|billing|merchant|commerce)(?:[/:._-]|$)/iu.test(
    target,
  );

const isPaymentApplicationIdentifier = (identifier: string): boolean => {
  if (paymentApplicationIdentifier.test(identifier)) return true;
  const normalized = identifier.toLowerCase();
  return (
    /^settlement\w*worker$/u.test(normalized) ||
    (normalized.includes("checkout") &&
      /(?:access|entitlement|grant)/u.test(normalized))
  );
};

const inspectTypeScript = (
  path: string,
  content: string,
  violations: string[],
): void => {
  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  if (
    EXPERT_RESIDENCY_ALLOWED_PATHS.has(path) &&
    forbiddenProviderContent.test(content)
  ) {
    violations.push("forbidden provider content in expert residency boundary");
  }

  if (path === "packages/integrations/src/index.ts") {
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement)) {
        violations.push("unapproved runtime declaration in integrations index");
      }
    }
  } else if (path === "packages/integrations/src/payment/payment-port.ts") {
    const allowedInterfaces = new Set([
      "CreateCheckoutCommand",
      "PaymentPort",
      "PaymentWebhookCommand",
      "RefundCommand",
    ]);
    for (const statement of source.statements) {
      if (
        !ts.isInterfaceDeclaration(statement) ||
        !allowedInterfaces.has(statement.name.text)
      ) {
        violations.push("unapproved declaration in payment port");
      }
    }
  } else if (
    path === "packages/integrations/src/payment/disabled-payment-adapter.ts"
  ) {
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const importClause = statement.importClause;
        const bindings = importClause?.namedBindings;
        const importedNames =
          bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map((element) => element.name.text)
            : [];
        if (
          !importClause?.isTypeOnly ||
          !bindings ||
          !ts.isNamedImports(bindings) ||
          importedNames.some(
            (name) =>
              ![
                "CreateCheckoutCommand",
                "PaymentPort",
                "PaymentWebhookCommand",
                "RefundCommand",
              ].includes(name),
          )
        ) {
          violations.push("unapproved import in disabled payment adapter");
        }
      } else if (
        !ts.isClassDeclaration(statement) ||
        !statement.name ||
        !["DisabledPaymentAdapter", "PaymentsDisabledError"].includes(
          statement.name.text,
        )
      ) {
        violations.push("unapproved declaration in disabled payment adapter");
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (isCommercialProviderSpecifier(specifier)) {
        violations.push(`provider SDK import: ${specifier}`);
      } else if (
        /(?:^|\/)payment(?:\/|[-_])/iu.test(specifier) &&
        !isApprovedPaymentBoundaryImport(path, specifier)
      ) {
        violations.push(
          `payment boundary import outside allowlist: ${specifier}`,
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const specifier = moduleSpecifierFromCall(node);
      if (specifier) {
        if (isCommercialProviderSpecifier(specifier)) {
          violations.push(`payment provider runtime import: ${specifier}`);
        } else if (
          /(?:^|\/)payment(?:\/|[-_])/iu.test(specifier) &&
          !isApprovedPaymentBoundaryImport(path, specifier)
        ) {
          violations.push(
            `payment boundary runtime import outside allowlist: ${specifier}`,
          );
        }
      }
    }

    if (path.startsWith("apps/api/")) {
      if (ts.isCallExpression(node)) {
        const route = routeFromCall(node);
        if (
          route &&
          commercialRoute.test(route) &&
          !EXPERT_RESIDENCY_ALLOWED_ROUTES.has(route)
        ) {
          violations.push(`commercial API route: ${route}`);
        }
        if (
          route &&
          expertResidencyRoute.test(route) &&
          !EXPERT_RESIDENCY_ALLOWED_ROUTES.has(route)
        ) {
          violations.push(`unapproved expert residency API route: ${route}`);
        }
      }
      if (ts.isIdentifier(node) && paymentApiIdentifier.test(node.text)) {
        violations.push(`commercial API route identifier: ${node.text}`);
      }
    }

    if (
      path.startsWith("packages/application/") &&
      ts.isIdentifier(node) &&
      isPaymentApplicationIdentifier(node.text)
    ) {
      violations.push(`payment application identifier: ${node.text}`);
    }

    if (
      path.startsWith("packages/db/") &&
      ts.isCallExpression(node) &&
      /^(?:pgTable|mysqlTable|sqliteTable|pgView|pgMaterializedView)$/u.test(
        ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : "",
      )
    ) {
      const tableName = literalText(node.arguments[0]);
      if (tableName && !approvedDatabaseRelations.has(tableName)) {
        violations.push(`unapproved database relation: ${tableName}`);
      }
    }

    if (ts.isCallExpression(node) && isNetworkCall(node)) {
      const target = literalText(node.arguments[0]);
      if (
        approvedPaymentBoundaryPaths.has(path) ||
        EXPERT_RESIDENCY_ALLOWED_PATHS.has(path) ||
        (target && isCommercialNetworkTarget(target))
      ) {
        violations.push("payment provider network call");
      }
    }

    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const key = processEnvKey(node);
      if (
        key &&
        (approvedPaymentBoundaryPaths.has(path) || isPaymentCredentialKey(key))
      ) {
        violations.push(`payment credential environment access: ${key}`);
      }
      if (
        key &&
        expertResidencyFlag.test(key) &&
        !EXPERT_RESIDENCY_ALLOWED_FLAGS.has(key)
      ) {
        violations.push(`unapproved expert residency environment flag: ${key}`);
      }
    }

    if (
      ts.isStringLiteral(node) &&
      expertResidencyAdminAction.test(node.text) &&
      !EXPERT_RESIDENCY_ALLOWED_ADMIN_ACTIONS.has(node.text)
    ) {
      violations.push(`unapproved expert residency admin action: ${node.text}`);
    }

    if (
      path === "packages/integrations/src/payment/payment-port.ts" &&
      ts.isClassDeclaration(node)
    ) {
      violations.push("runtime class in payment port");
    }

    if (
      path ===
        "packages/integrations/src/payment/disabled-payment-adapter.ts" &&
      ts.isClassDeclaration(node) &&
      node.name &&
      !["DisabledPaymentAdapter", "PaymentsDisabledError"].includes(
        node.name.text,
      )
    ) {
      violations.push(`unapproved payment adapter class: ${node.name.text}`);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
};

const inspectPackageManifest = (
  path: string,
  content: string,
  violations: string[],
): void => {
  let manifest: unknown;
  try {
    manifest = JSON.parse(content);
  } catch {
    violations.push("package manifest is not valid JSON");
    return;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    violations.push("package manifest is not an object");
    return;
  }

  const approvedDependencies = approvedPackageDependencies.get(path);
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const section = (manifest as Record<string, unknown>)[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }
    for (const dependency of Object.keys(section)) {
      const specifier = (section as Record<string, unknown>)[dependency];
      if (
        !approvedDependencies?.has(dependency) ||
        specifier !== approvedDependencySpecifiers.get(dependency)
      ) {
        violations.push(`unapproved package dependency: ${dependency}`);
      }
    }
  }
};

const inspectMigration = (
  path: string,
  content: string,
  violations: string[],
): void => {
  if (paymentDbPath.test(path)) {
    violations.push("commercial database migration path");
  }
  if (path.endsWith(".json")) {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(content);
    } catch {
      violations.push("database snapshot is not valid JSON");
      return;
    }
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return;
    }
    for (const sectionName of ["tables", "views"]) {
      const section = (snapshot as Record<string, unknown>)[sectionName];
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }
      for (const relation of Object.values(section)) {
        if (
          !relation ||
          typeof relation !== "object" ||
          Array.isArray(relation)
        ) {
          continue;
        }
        const name = (relation as Record<string, unknown>).name;
        if (typeof name === "string" && !approvedDatabaseRelations.has(name)) {
          violations.push(`unapproved database snapshot relation: ${name}`);
        }
      }
    }
    return;
  }

  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/--[^\r\n]*/gu, "");
  for (const match of withoutComments.matchAll(
    /\bcreate\s+(?:materialized\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:(?:"?[\w]+"?)\.)?"?([\w]+)"?/giu,
  )) {
    const relationName = match[1];
    if (relationName && !approvedDatabaseRelations.has(relationName)) {
      violations.push(
        `unapproved database migration relation: ${relationName}`,
      );
    }
  }
};

export const classifyPaymentScopeProbe = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);

  const violations: string[] = [];
  if (path.startsWith("packages/integrations/")) {
    if (
      !approvedPaymentBoundaryPaths.has(path) &&
      !EXPERT_RESIDENCY_ALLOWED_PATHS.has(path) &&
      (providerPath.test(path) || paymentIntegrationArtifact.test(path))
    ) {
      violations.push("live or deferred payment integration path");
    }
    if (
      path.startsWith("packages/integrations/src/expert-residency/") &&
      !EXPERT_RESIDENCY_ALLOWED_PATHS.has(path)
    ) {
      violations.push("unapproved expert residency integration path");
    }
  } else if (path.startsWith("apps/api/") && paymentApiPath.test(path)) {
    violations.push("commercial API route path");
  } else if (
    path.startsWith("packages/application/") &&
    paymentApplicationPath.test(path)
  ) {
    violations.push("payment consumer or entitlement path");
  } else if (path.startsWith("packages/db/") && paymentDbPath.test(path)) {
    violations.push("commercial database schema path");
  }

  if (
    path.startsWith("packages/domain/src/") &&
    prohibitedCouponOrReferralModel.test(path)
  ) {
    violations.push("commercial coupon or referral domain model path");
  }

  if (path.endsWith("/package.json") || path === "package.json") {
    inspectPackageManifest(path, content, violations);
  } else if (/^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path)) {
    inspectMigration(path, content, violations);
  } else if (/\.[cm]?[jt]sx?$/u.test(path)) {
    inspectTypeScript(path, content, violations);
  }

  return [...new Set(violations)].sort();
};

export const classifyApprovedTrackedScopeContent = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);
  const isPackageManifest =
    path.endsWith("/package.json") || path === "package.json";
  const isMigration = path.startsWith("packages/db/migrations/");
  const expectedHash =
    approvedPaymentBoundaryHashes.get(path) ??
    approvedMigrationHashes.get(path) ??
    approvedPackageManifestHashes.get(path) ??
    approvedAutomationArtifactHashes.get(path);
  if (!expectedHash) {
    if (isPackageManifest) return ["unapproved package manifest artifact path"];
    if (isMigration) return ["unapproved database migration artifact path"];
    if (isExecutableAutomationPath(path)) {
      return ["unapproved executable or automation artifact path"];
    }
    return [];
  }
  const normalizedContent = content.replace(/\r\n?/gu, "\n");
  const actualHash = createHash("sha256")
    .update(normalizedContent, "utf8")
    .digest("hex");
  return actualHash === expectedHash
    ? []
    : [`approved tracked scope hash mismatch: ${actualHash}`];
};
