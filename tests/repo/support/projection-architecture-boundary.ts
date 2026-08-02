import ts from "typescript";

export interface ProjectionArchitectureSource {
  path: string;
  content: string;
}

const projectionBarrelExports = new Set([
  "MakeProjectionPermanentFailure",
  "MakeProjectionRetryableFailure",
  "MakeProjectionSink",
  "MakeProjectionRequest",
  "MakeProjectionResponse",
  "MakeProjectionSinkDeps",
  "ProjectionEvent",
  "ProjectionSink",
  "ProjectionTopic",
]);

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const isAllowedProjectionConsumer = (path: string): boolean =>
  path.startsWith("packages/worker/") ||
  path === "packages/integrations/src/index.ts" ||
  path.startsWith("packages/integrations/src/projections/");

const moduleSpecifier = (
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): string | undefined =>
  statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : undefined;

const staticModuleSpecifier = (expression: ts.Expression | undefined): string | undefined =>
  expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text
    : undefined;

const isDirectProjectionSpecifier = (specifier: string): boolean =>
  specifier.includes("/projections/") || specifier.includes("projection-port");

const importedName = (element: ts.ImportSpecifier | ts.ExportSpecifier): string =>
  (element.propertyName ?? element.name).text;

const isProjectionBarrelExport = (
  element: ts.ImportSpecifier | ts.ExportSpecifier,
): boolean => projectionBarrelExports.has(importedName(element));

const runtimeProjectionViolation = (
  path: string,
  specifier: string,
  edge: string,
): string | undefined => {
  if (isDirectProjectionSpecifier(specifier)) {
    return `${path}: ${edge} direct projection import`;
  }
  return specifier === "@ii-tonya/integrations"
    ? `${path}: ${edge} projection barrel import`
    : undefined;
};

export const findProjectionImportViolations = ({
  path: rawPath,
  content,
}: ProjectionArchitectureSource): string[] => {
  const path = normalizePath(rawPath);
  if (isAllowedProjectionConsumer(path)) return [];

  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = moduleSpecifier(statement);
      if (!specifier) continue;
      if (isDirectProjectionSpecifier(specifier)) {
        violations.push(`${path}: direct projection import`);
        continue;
      }
      if (specifier !== "@ii-tonya/integrations") continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        violations.push(`${path}: projection barrel namespace import`);
      } else if (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(isProjectionBarrelExport)
      ) {
        violations.push(`${path}: projection barrel named import`);
      }
      continue;
    }

    if (!ts.isExportDeclaration(statement)) continue;
    const specifier = moduleSpecifier(statement);
    if (!specifier) continue;
    if (isDirectProjectionSpecifier(specifier)) {
      violations.push(`${path}: direct projection re-export`);
      continue;
    }
    if (specifier !== "@ii-tonya/integrations") continue;
    if (!statement.exportClause) {
      violations.push(`${path}: projection barrel export star`);
    } else if (ts.isNamespaceExport(statement.exportClause)) {
      violations.push(`${path}: projection barrel namespace re-export`);
    } else if (
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(isProjectionBarrelExport)
    ) {
      violations.push(`${path}: projection barrel named re-export`);
    }
  }

  const inspectRuntimeEdges = (node: ts.Node): void => {
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const violation = runtimeProjectionViolation(
        path,
        staticModuleSpecifier(node.moduleReference.expression) ?? "",
        "TypeScript import equals require",
      );
      if (violation) violations.push(violation);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isCommonJsRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isCommonJsRequire) {
        const violation = runtimeProjectionViolation(
          path,
          staticModuleSpecifier(node.arguments[0]) ?? "",
          isDynamicImport ? "dynamic import" : "CommonJS require",
        );
        if (violation) violations.push(violation);
      }
    }
    ts.forEachChild(node, inspectRuntimeEdges);
  };
  inspectRuntimeEdges(source);
  return violations;
};
