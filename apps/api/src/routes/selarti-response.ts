import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { RateLimitGate } from "../rate-limit.js";

type ResponseService = {
  handle(raw: unknown): Promise<{
    readonly status: string;
  }>;
};

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
  app.post(
    "/v1/webhooks/selarti/responses",
    {
      bodyLimit: 65_536,
      schema: { body: { type: "object", additionalProperties: true } },
    },
    async (request, reply) => {
      const authorization = request.headers.authorization;
      if (!secureEqual(authorization, `Bearer ${deps.secret}`)) {
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
      if (
        result.status === "rejected" ||
        result.status === "conflict" ||
        result.status === "late"
      ) {
        return { accepted: true, rejected: true };
      }
      return { accepted: true };
    },
  );
};
