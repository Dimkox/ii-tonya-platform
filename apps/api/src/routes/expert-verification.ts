import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ExpertVerificationService } from "@ii-tonya/application";
import { createWindowedRateLimiter } from "../rate-limit.js";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const session = (header: unknown): string | null => {
  if (typeof header !== "string") return null;
  const token = /^Bearer ([A-Za-z0-9._~-]{24,512})$/u.exec(header)?.[1];
  return token
    ? `sha256:${createHash("sha256").update(token).digest("hex")}`
    : null;
};
const code = (kind: string) =>
  kind === "forbidden"
    ? 403
    : kind === "invalid"
      ? 400
      : kind === "not_found"
        ? 404
        : 503;
export const expertVerificationRoutes: FastifyPluginAsync<{
  enabled: boolean;
  service?: Pick<
    ExpertVerificationService,
    "list" | "detail" | "decide" | "checkout"
  > &
    Partial<Pick<ExpertVerificationService, "reverifyProfile">>;
}> = async (app, deps) => {
  if (!deps.enabled) return;
  const service = deps.service;
  if (!service) throw new Error("expert_verification_capability_required");
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  const limiter = createWindowedRateLimiter();
  app.addHook("preHandler", async (req, reply) => {
    if (!limiter.consume(`verification:${req.ip}`, 60, 60_000))
      return reply.code(429).send({ error: "rate_limited" });
    if (!session(req.headers.authorization))
      return reply.code(401).send({ error: "unauthorized" });
  });
  app.setErrorHandler((error, _request, reply) => {
    const status =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 503;
    return reply
      .code(status < 500 ? 400 : 503)
      .send({ error: "verification_unavailable" });
  });
  app.get<{ Querystring: { limit?: string } }>(
    "/v1/admin/expert-verification",
    async (req, reply) => {
      const keys = Object.keys(req.query);
      if (
        keys.some((k) => k !== "limit") ||
        (req.query.limit !== undefined &&
          !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(req.query.limit))
      )
        return reply.code(400).send({ error: "invalid_request" });
      const result = await service.list(session(req.headers.authorization)!, {
        limit: Number(req.query.limit ?? 50),
      });
      return result.kind === "ok"
        ? result
        : reply.code(code(result.kind)).send({ error: result.kind });
    },
  );
  app.get<{ Params: { applicationId: string } }>(
    "/v1/admin/expert-verification/:applicationId",
    async (req, reply) => {
      if (!uuid.test(req.params.applicationId))
        return reply.code(400).send({ error: "invalid_request" });
      const result = await service.detail(
        session(req.headers.authorization)!,
        req.params.applicationId,
      );
      return result.kind === "ok"
        ? result
        : reply.code(code(result.kind)).send({ error: result.kind });
    },
  );
  app.post<{ Params: { invoiceId: string } }>(
    "/v1/admin/expert-verification/invoices/:invoiceId/checkout",
    { bodyLimit: 1024 },
    async (req, reply) => {
      if (!uuid.test(req.params.invoiceId) || req.body !== undefined)
        return reply.code(400).send({ error: "invalid_request" });
      const result = await service.checkout(
        session(req.headers.authorization)!,
        req.params.invoiceId,
      );
      return result.kind === "ok"
        ? result
        : reply.code(code(result.kind)).send({ error: result.kind });
    },
  );
  app.post<{ Params: { applicationId: string }; Body: unknown }>(
    "/v1/admin/expert-verification/:applicationId/profile-verification",
    { bodyLimit: 1024 },
    async (req, reply) => {
      const b = req.body as Record<string, unknown> | null;
      if (
        !uuid.test(req.params.applicationId) ||
        !b ||
        typeof b !== "object" ||
        Array.isArray(b) ||
        Object.keys(b).join(",") !== "revision" ||
        !Number.isSafeInteger(b.revision) ||
        Number(b.revision) < 1
      )
        return reply.code(400).send({ error: "invalid_request" });
      if (!service.reverifyProfile)
        return reply.code(503).send({ error: "unavailable" });
      const result = await service.reverifyProfile(
        session(req.headers.authorization)!,
        req.params.applicationId,
        Number(b.revision),
      );
      return result.kind === "ok"
        ? result
        : reply.code(code(result.kind)).send({ error: result.kind });
    },
  );
  app.post<{ Params: { applicationId: string }; Body: unknown }>(
    "/v1/admin/expert-verification/:applicationId/decision",
    { bodyLimit: 2048 },
    async (req, reply) => {
      const body = req.body;
      if (
        !uuid.test(req.params.applicationId) ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(",") !==
          "decision,idempotencyKey,reasonCode"
      )
        return reply.code(400).send({ error: "invalid_request" });
      const b = body as Record<string, unknown>;
      if (
        (b.decision !== "approved" && b.decision !== "rejected") ||
        typeof b.reasonCode !== "string" ||
        !/^[a-z][a-z0-9_]{0,63}$/u.test(b.reasonCode) ||
        typeof b.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(b.idempotencyKey)
      )
        return reply.code(400).send({ error: "invalid_request" });
      const result = await service.decide(session(req.headers.authorization)!, {
        applicationId: req.params.applicationId,
        decision: b.decision,
        reasonCode: b.reasonCode,
        idempotencyKey: b.idempotencyKey,
      });
      return result.kind === "ok"
        ? result
        : reply.code(code(result.kind)).send({ error: result.kind });
    },
  );
};
