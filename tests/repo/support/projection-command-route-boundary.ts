import ts from "typescript";

export interface ProjectionRouteSource {
  path: string;
  content: string;
}

const routeMethods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "route",
]);

const projectionRoute = /(?:^|[/_-])(?:make|sheets?)(?:[/_-]|$)/iu;

const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;

const staticText = (expression: ts.Expression): string | undefined =>
  ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined;

const callTarget = (
  expression: ts.LeftHandSideExpression,
): { receiver: string; method: string } | undefined => {
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return { receiver: expression.expression.text, method: expression.name.text };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.argumentExpression
  ) {
    const method = staticText(expression.argumentExpression);
    return method === undefined
      ? undefined
      : { receiver: expression.expression.text, method };
  }
  return undefined;
};

export const findProjectionCommandRouteViolations = ({
  path: rawPath,
  content,
}: ProjectionRouteSource): string[] => {
  const path = rawPath.replaceAll("\\", "/");
  if (!path.startsWith("apps/api/")) return [];
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const constants = new Map<string, ts.Expression>();

  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        constants.set(node.name.text, node.initializer);
      }
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(source);

  const resolveExpression = (
    expression: ts.Expression | undefined,
    seen = new Set<string>(),
  ): ts.Expression | undefined => {
    if (!expression || !ts.isIdentifier(expression)) return expression;
    if (seen.has(expression.text)) return undefined;
    seen.add(expression.text);
    return resolveExpression(constants.get(expression.text), seen);
  };

  const resolveText = (expression: ts.Expression | undefined): string | undefined => {
    const resolved = resolveExpression(expression);
    return resolved ? staticText(resolved) : undefined;
  };

  const objectProperty = (
    expression: ts.Expression | undefined,
    name: string,
  ): ts.Expression | undefined => {
    const resolved = resolveExpression(expression);
    if (!resolved || !ts.isObjectLiteralExpression(resolved)) return undefined;
    const property = resolved.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
    );
    return property?.initializer;
  };

  const violations: string[] = [];
  const inspect = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, inspect);
      return;
    }

    const target = callTarget(node.expression);
    if (!target) {
      ts.forEachChild(node, inspect);
      return;
    }

    if (target.method === "register") {
      const prefix = resolveText(objectProperty(node.arguments[1], "prefix"));
      if (prefix && projectionRoute.test(prefix)) {
        violations.push(`${path}: Fastify register prefix ${prefix}`);
      }
    } else if (routeMethods.has(target.method)) {
      const route = target.method === "route"
        ? resolveText(objectProperty(node.arguments[0], "url"))
        : resolveText(node.arguments[0]);
      if (route && projectionRoute.test(route)) {
        violations.push(`${path}: Fastify ${target.method} route ${route}`);
      }
    }

    ts.forEachChild(node, inspect);
  };
  inspect(source);
  return violations;
};
