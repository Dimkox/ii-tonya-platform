import { createHash } from "node:crypto";
import * as ts from "typescript";

export const PAYMENT_SCOPE_MAX_TRACKED_FILES = 5_000;
export const PAYMENT_SCOPE_MAX_FILE_BYTES = 1_048_576;

const approvedPaymentBoundaryPaths = new Set([
  "packages/integrations/src/index.ts",
  "packages/integrations/src/payment/disabled-payment-adapter.ts",
  "packages/integrations/src/payment/payment-port.ts",
]);
const approvedPaymentBoundaryHashes = new Map([
  [
    "packages/integrations/src/index.ts",
    "fb15704134cb61cca1cbb8b12d7f760e76e0b0c2cd7c6a1a8e50fca0e8ac70f0",
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
    "eb1144b1f7b877efe8f6114ee9b627a8d065bfb64fbed3617e8463a8b3f83936",
  ],
  [
    "apps/worker/package.json",
    "64c1c21fe5fd48e62fecc815ddce23a0564c69fc081fc0ede85418763762fb91",
  ],
  [
    "package.json",
    "ef4322d6abff5c0efa15392c3f3152a24b95ec665300bad64c35155c7a8800ca",
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
    "5f5e78ae5b15576ce6efc4db9f6bd9c43519d2eb9c5cdf553ad216a81c06cece",
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
    "f63fa081290353e171acddd22318f51dde50f2fb349f1e97fb0da0be07afc9f6",
  ],
  [
    "packages/worker/package.json",
    "da18d8b8bbfa95815d8d9bfae9a2de15125c8bd91e2c84be1e4de73706fa8cd7",
  ],
]);
const approvedAutomationArtifactHashes = new Map([
  [
    ".github/workflows/db-gate.yml",
    "cf03fe5ad90b3538f0a0762476c6179660f8ee12081e4152c7e3afa31fbee690",
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
  ["@opentelemetry/sdk-node", "^0.203.0"],
  ["@testcontainers/postgresql", "^10.28.0"],
  ["@types/node", "^24.0.0"],
  ["@types/pg", "^8.15.5"],
  ["@vitest/coverage-v8", "^3.2.4"],
  ["drizzle-kit", "^0.31.4"],
  ["drizzle-orm", "^0.44.3"],
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
    "packages/db/migrations/meta/_journal.json",
    "90360b155e098c1f55b94a60553bb1e8844da3cb65b3836ddfa6ec1ab2ff5955",
  ],
]);
const approvedDatabaseRelations = new Set([
  "admin_approvals",
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
  "integration_inbox",
  "integration_outbox",
  "message_events",
  "message_ledger_entries",
  "message_packages",
  "notifications",
  "outbox_operator_alerts",
  "package_balances",
  "privacy_deletion_jobs",
  "privacy_processor_attempts",
  "projection_checkpoints",
  "prompt_versions",
  "provider_cursors",
  "reconciliation_mismatches",
  "reconciliation_runs",
  "reservations",
  "safety_incidents",
  "slots",
  "users",
]);

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
const paymentApiPath =
  /(?:^|\/)(?:checkout|payments?|refunds?)(?:[-_.\/]|$)/iu;
const paymentApplicationPath =
  /(?:^|\/)(?:payments?(?:[-_].*)?|.*payment[-_](?:consumer|handler)|entitlement[-_]grant|settlement[-_]worker|checkout[-_].*(?:access|entitlement|grant))(?:[-_.\/]|$)/iu;
const paymentDbPath =
  /(?:^|\/)(?:payments?|refunds?|charges?)(?:[-_.\/]|$)/iu;
const commercialRoute =
  /\/(?:checkout|payments?|refunds?|stripe|yookassa)(?:\/|$)/iu;
const paymentApplicationIdentifier =
  /^(?:Payment\w*Consumer|\w*PaymentConsumer|grant\w*Entitlement\w*Payment|grant\w*Payment\w*Entitlement|Payment\w*EntitlementGrant|(?:Payment|Checkout|Refund)\w*Routes?)$/iu;
const paymentApiIdentifier =
  /^(?:payment|checkout|refund|stripe|yookassa)\w*Routes?$/iu;

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
  if (
    /^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path)
  ) {
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

const callMethodName = (expression: ts.LeftHandSideExpression): string | undefined => {
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
    ].includes(specifier)) ||
  (path ===
    "packages/integrations/src/payment/disabled-payment-adapter.ts" &&
    specifier === "./payment-port.js");

const isNetworkCall = (node: ts.CallExpression): boolean => {
  if (ts.isIdentifier(node.expression)) {
    return /^(?:fetch|request)$/u.test(node.expression.text);
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const owner = node.expression.expression;
  return (
    ts.isIdentifier(owner) &&
    /^(?:axios|http|https|undici)$/u.test(owner.text)
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
    path ===
    "packages/integrations/src/payment/disabled-payment-adapter.ts"
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
        violations.push(`payment boundary import outside allowlist: ${specifier}`);
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
        if (route && commercialRoute.test(route)) {
          violations.push(`commercial API route: ${route}`);
        }
      }
      if (
        ts.isIdentifier(node) &&
        paymentApiIdentifier.test(node.text)
      ) {
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

    if (
      ts.isCallExpression(node) &&
      isNetworkCall(node)
    ) {
      const target = literalText(node.arguments[0]);
      if (
        approvedPaymentBoundaryPaths.has(path) ||
        (target && isCommercialNetworkTarget(target))
      ) {
        violations.push("payment provider network call");
      }
    }

    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node))
    ) {
      const key = processEnvKey(node);
      if (
        key &&
        (approvedPaymentBoundaryPaths.has(path) ||
          isPaymentCredentialKey(key))
      ) {
        violations.push(`payment credential environment access: ${key}`);
      }
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
        if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
          continue;
        }
        const name = (relation as Record<string, unknown>).name;
        if (
          typeof name === "string" &&
          !approvedDatabaseRelations.has(name)
        ) {
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
      violations.push(`unapproved database migration relation: ${relationName}`);
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
      (providerPath.test(path) || paymentIntegrationArtifact.test(path))
    ) {
      violations.push("live or deferred payment integration path");
    }
  } else if (path.startsWith("apps/api/") && paymentApiPath.test(path)) {
    violations.push("commercial API route path");
  } else if (
    path.startsWith("packages/application/") &&
    paymentApplicationPath.test(path)
  ) {
    violations.push("payment consumer or entitlement path");
  } else if (
    path.startsWith("packages/db/") &&
    paymentDbPath.test(path)
  ) {
    violations.push("commercial database schema path");
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
