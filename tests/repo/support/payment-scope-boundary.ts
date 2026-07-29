import * as ts from "typescript";

export const PAYMENT_SCOPE_MAX_TRACKED_FILES = 5_000;
export const PAYMENT_SCOPE_MAX_FILE_BYTES = 1_048_576;

const approvedPaymentBoundaryPaths = new Set([
  "packages/integrations/src/index.ts",
  "packages/integrations/src/payment/disabled-payment-adapter.ts",
  "packages/integrations/src/payment/payment-port.ts",
]);

const providerName =
  /^(?:@stripe\/|stripe(?:\/|$)|@yookassa\/|yookassa(?:\/|$)|@a2seven\/yoo-checkout(?:\/|$)|cloudpayments(?:\/|$)|paypal(?:\/|$)|@paypal\/|adyen(?:\/|$)|@adyen\/|square(?:\/|$)|@square\/)/iu;
const providerPath =
  /(?:^|\/)(?:commercial|commerce|stripe|yookassa|cloudpayments|paypal|adyen|square)(?:[-_.\/]|$)/iu;
const paymentIntegrationArtifact =
  /(?:^|\/)payments?(?:[-_](?:adapter|client|codec|gateway|provider|service))?(?:[-_.\/]|$)/iu;
const paymentApiPath =
  /(?:^|\/)(?:checkout|payments?|refunds?)(?:[-_.\/]|$)/iu;
const paymentApplicationPath =
  /(?:^|\/)(?:payments?(?:[-_].*)?|.*payment[-_](?:consumer|handler)|entitlement[-_]grant)(?:[-_.\/]|$)/iu;
const paymentDbPath =
  /(?:^|\/)(?:payments?|refunds?|charges?)(?:[-_.\/]|$)/iu;
const commercialRoute =
  /\/(?:checkout|payments?|refunds?|stripe|yookassa)(?:\/|$)/iu;
const paymentTableName = /^(?:payments?|refunds?|charges?)$/iu;
const paymentApplicationIdentifier =
  /^(?:Payment\w*Consumer|\w*PaymentConsumer|grant\w*Entitlement\w*Payment|grant\w*Payment\w*Entitlement|Payment\w*EntitlementGrant|(?:Payment|Checkout|Refund)\w*Routes?)$/iu;
const paymentApiIdentifier =
  /^(?:payment|checkout|refund|stripe|yookassa)\w*Routes?$/iu;

export interface PaymentScopeProbe {
  readonly path: string;
  readonly content: string;
}

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const isTestSource = (path: string): boolean =>
  /\.(?:test|spec|testkit)\.[cm]?[jt]sx?$/u.test(path);

export const isPaymentScopeInspectionPath = (rawPath: string): boolean => {
  const path = normalizePath(rawPath);
  if (path.endsWith("/package.json") || path === "package.json") return true;
  if (
    /^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path)
  ) {
    return true;
  }
  return (
    /^(?:apps|packages)\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/u.test(path) &&
    !isTestSource(path)
  );
};

const literalText = (node: ts.Expression | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const routeFromCall = (node: ts.CallExpression): string | undefined => {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const method = node.expression.name.text;
  if (["get", "post", "put", "patch", "delete"].includes(method)) {
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

const isProcessEnvAccess = (node: ts.PropertyAccessExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "process" &&
  node.expression.name.text === "env";

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

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (providerName.test(specifier)) {
        violations.push(`provider SDK import: ${specifier}`);
      } else if (
        /(?:^|\/)payment(?:\/|[-_])/iu.test(specifier) &&
        !isApprovedPaymentBoundaryImport(path, specifier)
      ) {
        violations.push(`payment boundary import outside allowlist: ${specifier}`);
      }
    }

    if (path.startsWith("apps/api/src/")) {
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
      path.startsWith("packages/application/src/") &&
      ts.isIdentifier(node) &&
      paymentApplicationIdentifier.test(node.text)
    ) {
      violations.push(`payment application identifier: ${node.text}`);
    }

    if (
      path.startsWith("packages/db/src/") &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^(?:pgTable|mysqlTable|sqliteTable)$/u.test(node.expression.text)
    ) {
      const tableName = literalText(node.arguments[0]);
      if (tableName && paymentTableName.test(tableName)) {
        violations.push(`commercial database table: ${tableName}`);
      }
    }

    if (
      approvedPaymentBoundaryPaths.has(path) &&
      ts.isCallExpression(node) &&
      isNetworkCall(node)
    ) {
      violations.push("network call in payment integration boundary");
    }

    if (
      approvedPaymentBoundaryPaths.has(path) &&
      ts.isPropertyAccessExpression(node) &&
      isProcessEnvAccess(node)
    ) {
      violations.push("credential environment access in integration boundary");
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
      if (providerName.test(dependency)) {
        violations.push(`payment provider dependency: ${dependency}`);
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
    if (
      /"name"\s*:\s*"(?:payments?|refunds?|charges?)"/iu.test(content)
    ) {
      violations.push("commercial database snapshot table");
    }
    return;
  }

  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/--[^\r\n]*/gu, "");
  if (
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:"[^"]+"\.)?"?(?:payments?|refunds?|charges?)"?\b/iu.test(
      withoutComments,
    )
  ) {
    violations.push("commercial database migration table");
  }
};

export const classifyPaymentScopeProbe = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);

  const violations: string[] = [];
  if (path.startsWith("packages/integrations/src/")) {
    if (
      !approvedPaymentBoundaryPaths.has(path) &&
      (providerPath.test(path) || paymentIntegrationArtifact.test(path))
    ) {
      violations.push("live or deferred payment integration path");
    }
  } else if (path.startsWith("apps/api/src/") && paymentApiPath.test(path)) {
    violations.push("commercial API route path");
  } else if (
    path.startsWith("packages/application/src/") &&
    paymentApplicationPath.test(path)
  ) {
    violations.push("payment consumer or entitlement path");
  } else if (
    path.startsWith("packages/db/src/") &&
    paymentDbPath.test(path)
  ) {
    violations.push("commercial database schema path");
  }

  if (path.endsWith("/package.json") || path === "package.json") {
    inspectPackageManifest(content, violations);
  } else if (/^packages\/db\/migrations\/.+\.(?:sql|json)$/u.test(path)) {
    inspectMigration(path, content, violations);
  } else if (/\.[cm]?[jt]sx?$/u.test(path)) {
    inspectTypeScript(path, content, violations);
  }

  return [...new Set(violations)].sort();
};
