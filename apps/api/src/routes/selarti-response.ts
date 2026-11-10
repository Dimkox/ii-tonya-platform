import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { RateLimitGate } from "../rate-limit.js";

type ResponseService = {
  handle(raw: unknown): Promise<{
    readonly status: string;
  }>;
};

function secureEqual(actual: string | undefined, expected: string): boolean {
  const left = createHash("sha256")
    .update(actual ?? "")
    .digest();
  const right = createHash("sha256").update(expected).digest();
  return actual !== undefined && timingSafeEqual(left, right);
}

function singleString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const selartiResponseRoutes: FastifyPluginAsync<{
  readonly enabled: boolean;
  readonly secret: string;
  readonly responses: ResponseService;
  readonly rateLimiter: RateLimitGate;
  readonly authenticatedLimit?: number;
  readonly unauthenticatedLimit?: number;
}> = async (app, deps) => {
  if (
    deps.enabled &&
    (deps.secret.length < 32 ||
      deps.secret.length > 256 ||
      !/^[A-Za-z0-9_-]+$/u.test(deps.secret) ||
      /placeholder/iu.test(deps.secret))
  ) {
    throw new Error("selarti_response_auth_configuration_invalid");
  }
  const handler = async (
    request: FastifyRequest<{ Params: { token?: string } }>,
    reply: FastifyReply,
  ) => {
    const query = request.query as { token?: unknown };
    const params = request.params as { token?: unknown } | undefined;
    const bearerOk = secureEqual(
      singleString(request.headers.authorization),
      `Bearer ${deps.secret}`,
    );
    const queryOk = secureEqual(singleString(query.token), deps.secret);
    const pathOk = secureEqual(singleString(params?.token), deps.secret);
    if (!bearerOk && !queryOk && !pathOk) {
      const allowed = deps.rateLimiter.consume(
        `selarti-response:unauth:${request.ip}`,
        deps.unauthenticatedLimit ?? 100,
        60_000,
      );
      return reply.code(allowed ? 401 : 429).send({ error: "unauthorized" });
    }
    if (!deps.enabled) {
      return reply.code(503).send({ error: "selarti_response_unavailable" });
    }
    if (
      !deps.rateLimiter.consume(
        "selarti-response:auth:provider",
        deps.authenticatedLimit ?? 100,
        60_000,
      )
    ) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    let result: { status: string };
    try {
      result = await deps.responses.handle(request.body);
    } catch {
      return reply.code(503).send({ error: "selarti_response_unavailable" });
    }
    if (result.status === "unavailable")
      return reply.code(503).send({ error: "selarti_response_unavailable" });
    if (result.status === "duplicate")
      return { accepted: true, duplicate: true };
    if (result.status === "ignored") return { accepted: true, ignored: true };
    if (
      result.status === "rejected" ||
      result.status === "conflict" ||
      result.status === "late"
    ) {
      return { accepted: true, rejected: true };
    }
    return { accepted: true };
  };
  const route = {
    bodyLimit: 65_536,
    schema: { body: { type: "object", additionalProperties: true } },
  } as const;
  app.post("/v1/webhooks/selarti/responses", route, handler);
  app.post("/v1/webhooks/selarti/responses/:token", route, handler);
};
