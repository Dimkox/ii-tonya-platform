import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ResidentLifecycleStaffRepository } from "@ii-tonya/application";
import { createWindowedRateLimiter } from "../rate-limit.js";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const session = (header: unknown) => {
  const token =
    typeof header === "string"
      ? /^Bearer ([A-Za-z0-9._~-]{24,512})$/u.exec(header)?.[1]
      : undefined;
  return token
    ? "sha256:" + createHash("sha256").update(token).digest("hex")
    : null;
};
export const residentLifecycleRoutes: FastifyPluginAsync<{
  enabled: boolean;
  repository?: ResidentLifecycleStaffRepository;
}> = async (app, deps) => {
  if (!deps.enabled) return;
  if (!deps.repository) throw new Error("resident_lifecycle_staff_required");
  const repository = deps.repository,
    limiter = createWindowedRateLimiter();
  app.addHook("preHandler", async (req, reply) => {
    if (!limiter.consume(`resident-lifecycle:${req.ip}`, 60, 60000))
      return reply.code(429).send({ error: "rate_limited" });
    if (!session(req.headers.authorization))
      return reply.code(401).send({ error: "unauthorized" });
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    const message = error instanceof Error ? error.message : "";
    const code =
      message === "verification_forbidden"
        ? 403
        : message === "resident_lifecycle_invalid"
          ? 400
          : message === "resident_lifecycle_not_found"
            ? 404
            : message === "resident_lifecycle_conflict"
              ? 409
              : 503;
    return reply.code(code).send({
      error:
        code === 403
          ? "forbidden"
          : code === 409
            ? "conflict"
            : code === 404
              ? "not_found"
              : code === 400
                ? "invalid"
                : "unavailable",
    });
  });
  app.get("/v1/admin/expert-cards/lifecycle", async (req, reply) => {
    if (Object.keys(req.query as object).length)
      return reply.code(400).send({ error: "invalid" });
    return {
      kind: "ok",
      items: await repository.listCases(session(req.headers.authorization)!),
    };
  });
  app.get<{ Params: { caseId: string } }>(
    "/v1/admin/expert-cards/lifecycle/:caseId",
    async (req, reply) => {
      if (!uuid.test(req.params.caseId))
        return reply.code(400).send({ error: "invalid" });
      const item = await repository.readCase(
        session(req.headers.authorization)!,
        req.params.caseId,
      );
      return item
        ? { kind: "ok", item }
        : reply.code(404).send({ error: "not_found" });
    },
  );
  app.post<{ Params: { caseId: string }; Body: unknown }>(
    "/v1/admin/expert-cards/lifecycle/:caseId/close",
    { bodyLimit: 8192 },
    async (req, reply) => {
      const body = req.body;
      if (
        !uuid.test(req.params.caseId) ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).sort().join(",") !==
          "expectedRevision,idempotencyKey,resolution"
      )
        return reply.code(400).send({ error: "invalid" });
      const input = body as {
        expectedRevision: number;
        idempotencyKey: string;
        resolution: string;
      };
      return {
        kind: "ok",
        ...(await repository.closeCase({
          ...input,
          id: req.params.caseId,
          sessionHash: session(req.headers.authorization)!,
        })),
      };
    },
  );
};
