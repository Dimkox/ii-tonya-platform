import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import type {
  AdminPrincipal,
  OperatorCaseService,
} from "@ii-tonya/application";
import type { FastifyPluginAsync } from "fastify";

interface OperatorCaseApiDependencies {
  readonly approvals: {
    resolvePrincipal(sessionIdHash: string): Promise<AdminPrincipal | null>;
  };
  readonly cases: OperatorCaseService;
  readonly rateLimitMax?: number;
}

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "string", pattern: "^(?:[1-9]|[1-9][0-9]|100)$" },
    cursor: {
      type: "string",
      minLength: 16,
      maxLength: 256,
      pattern: "^[A-Za-z0-9_-]+$",
    },
  },
} as const;
const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["caseId", "transition"],
  properties: {
    caseId: { type: "string", pattern: uuidPattern },
    transition: { type: "string", enum: ["acknowledge", "resolve"] },
  },
} as const;

const resolvePrincipal = async (
  authorization: string | undefined,
  approvals: OperatorCaseApiDependencies["approvals"],
): Promise<AdminPrincipal | null> => {
  if (authorization === undefined || !authorization.startsWith("Bearer "))
    return null;
  const token = authorization.slice(7);
  if (token.length < 24 || token.length > 512) return null;
  const sessionIdHash = `sha256:${createHash("sha256")
    .update(token, "utf8")
    .digest("hex")}`;
  const principal = await approvals.resolvePrincipal(sessionIdHash);
  return principal?.sessionIdHash === sessionIdHash ? principal : null;
};

export const operatorCaseRoutes: FastifyPluginAsync<
  OperatorCaseApiDependencies
> = async (app, deps) => {
  await app.register(rateLimit, {
    max: deps.rateLimitMax ?? 60,
    timeWindow: 60_000,
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    "/v1/admin/operator-cases",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      const result = await deps.cases.listOpen(principal, {
        limit: Number(request.query.limit ?? "50"),
        ...(request.query.cursor === undefined
          ? {}
          : { cursor: request.query.cursor }),
      });
      if (result.kind !== "ok")
        return result.kind === "forbidden"
          ? reply.code(403).send({ error: "forbidden" })
          : reply.code(400).send({ error: "invalid_request" });
      return reply.code(200).send({
        items: result.items,
        ...(result.nextCursor === undefined
          ? {}
          : { nextCursor: result.nextCursor }),
      });
    },
  );

  app.post<{
    Params: { caseId: string; transition: "acknowledge" | "resolve" };
    Body: unknown;
  }>(
    "/v1/admin/operator-cases/:caseId/:transition",
    { schema: { params: paramsSchema } },
    async (request, reply) => {
      if (request.body !== undefined)
        return reply.code(400).send({ error: "invalid_request" });
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      const result = await deps.cases.transition(principal, {
        caseId: request.params.caseId,
        action: request.params.transition,
      });
      if (result.kind !== "updated" && result.kind !== "replayed") {
        if (result.kind === "forbidden")
          return reply.code(403).send({ error: "forbidden" });
        if (result.kind === "invalid")
          return reply.code(400).send({ error: "invalid_request" });
        if (result.kind === "not_found")
          return reply.code(404).send({ error: "not_found" });
        return reply.code(409).send({ error: "invalid_state" });
      }
      return reply.code(200).send({ status: result.kind, item: result.item });
    },
  );
};
