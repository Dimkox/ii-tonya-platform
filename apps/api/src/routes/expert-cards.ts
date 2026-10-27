import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ExpertCardAdminService } from "@ii-tonya/application";
import { createWindowedRateLimiter } from "../rate-limit.js";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const session = (v: unknown): string | null => {
  const token =
    typeof v === "string"
      ? /^Bearer ([A-Za-z0-9._~-]{24,512})$/u.exec(v)?.[1]
      : undefined;
  return token
    ? `sha256:${createHash("sha256").update(token).digest("hex")}`
    : null;
};
const status = (kind: string) =>
  kind === "forbidden"
    ? 403
    : kind === "invalid"
      ? 400
      : kind === "conflict"
        ? 409
        : kind === "not_found"
          ? 404
          : 503;
const mutation = (body: unknown, extras: string[]) =>
  object(body) &&
  Object.keys(body).sort().join(",") ===
    ["expectedRevision", "idempotencyKey", ...extras].sort().join(",") &&
  typeof body.expectedRevision === "number" &&
  Number.isSafeInteger(body.expectedRevision) &&
  body.expectedRevision >= 0 &&
  body.expectedRevision <= 2147483647 &&
  typeof body.idempotencyKey === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(body.idempotencyKey);
export const expertCardAdminRoutes: FastifyPluginAsync<{
  enabled: boolean;
  service?: Pick<
    ExpertCardAdminService,
    "list" | "detail" | "edit" | "review" | "confirmPromo"
  > &
    Partial<
      Pick<ExpertCardAdminService, "mediaLink" | "decideTag" | "exportTags">
    >;
}> = async (app, deps) => {
  if (!deps.enabled) return;
  const service = deps.service;
  if (!service) throw new Error("expert_card_admin_capability_required");
  const limiter = createWindowedRateLimiter();
  app.addHook("preHandler", async (req, reply) => {
    if (!limiter.consume(`card-admin:${req.ip}`, 60, 60_000))
      return reply.code(429).send({ error: "rate_limited" });
    if (!session(req.headers.authorization))
      return reply.code(401).send({ error: "unauthorized" });
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    const code =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 503;
    return reply
      .code(code < 500 ? 400 : 503)
      .send({ error: "card_service_unavailable" });
  });
  app.get("/v1/admin/expert-cards/catalogue-export", async (req, reply) => {
    if (!service.exportTags)
      return reply.code(503).send({ error: "unavailable" });
    const r = await service.exportTags(session(req.headers.authorization)!);
    if (r.kind !== "ok")
      return reply.code(status(r.kind)).send({ error: r.kind });
    reply.header(
      "Content-Disposition",
      'attachment; filename="expert-tags.json"',
    );
    return r;
  });
  app.post<{ Params: { applicationId: string }; Body: unknown }>(
    "/v1/admin/expert-cards/:applicationId/tags/review",
    { bodyLimit: 4096 },
    async (req, reply) => {
      if (!service.decideTag)
        return reply.code(503).send({ error: "unavailable" });
      if (
        !uuid.test(req.params.applicationId) ||
        !mutation(req.body, ["identity", "decision", "reason"]) ||
        !object(req.body)
      )
        return reply.code(400).send({ error: "invalid_request" });
      const body = req.body as Omit<
        Parameters<ExpertCardAdminService["decideTag"]>[1],
        "applicationId"
      >;
      const r = await service.decideTag(session(req.headers.authorization)!, {
        ...body,
        applicationId: req.params.applicationId,
      });
      return r.kind === "ok"
        ? r
        : reply.code(status(r.kind)).send({ error: r.kind });
    },
  );
  app.get<{ Querystring: { limit?: string } }>(
    "/v1/admin/expert-cards",
    async (req, reply) => {
      if (
        Object.keys(req.query).some((k) => k !== "limit") ||
        (req.query.limit !== undefined &&
          !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(req.query.limit))
      )
        return reply.code(400).send({ error: "invalid_request" });
      const result = await service.list(session(req.headers.authorization)!, {
        limit: Number(req.query.limit ?? 50),
      });
      return result.kind === "ok"
        ? result
        : reply.code(status(result.kind)).send({ error: result.kind });
    },
  );
  app.get<{ Params: { applicationId: string } }>(
    "/v1/admin/expert-cards/:applicationId",
    async (req, reply) => {
      if (!uuid.test(req.params.applicationId))
        return reply.code(400).send({ error: "invalid_request" });
      const result = await service.detail(
        session(req.headers.authorization)!,
        req.params.applicationId,
      );
      return result.kind === "ok"
        ? result
        : reply.code(status(result.kind)).send({ error: result.kind });
    },
  );
  app.post<{ Params: { applicationId: string; mediaId: string } }>(
    "/v1/admin/expert-cards/:applicationId/media/:mediaId/link",
    async (req, reply) => {
      if (!service.mediaLink)
        return reply.code(503).send({ error: "unavailable" });
      const r = await service.mediaLink(
        session(req.headers.authorization)!,
        req.params.applicationId,
        req.params.mediaId,
      );
      return r.kind === "ok"
        ? r
        : reply.code(status(r.kind)).send({ error: r.kind });
    },
  );
  app.post<{ Params: { applicationId: string }; Body: unknown }>(
    "/v1/admin/expert-cards/:applicationId/public-card",
    { bodyLimit: 32768 },
    async (req, reply) => {
      if (
        !uuid.test(req.params.applicationId) ||
        !mutation(req.body, ["publicCard"]) ||
        !object(req.body) ||
        !object(req.body.publicCard)
      )
        return reply.code(400).send({ error: "invalid_request" });
      const body = req.body as {
        expectedRevision: number;
        idempotencyKey: string;
        publicCard: Parameters<ExpertCardAdminService["edit"]>[1]["publicCard"];
      };
      const result = await service.edit(session(req.headers.authorization)!, {
        applicationId: req.params.applicationId,
        expectedRevision: body.expectedRevision,
        idempotencyKey: body.idempotencyKey,
        publicCard: body.publicCard,
      });
      return result.kind === "ok"
        ? result
        : reply.code(status(result.kind)).send({ error: result.kind });
    },
  );
  app.post<{ Params: { applicationId: string }; Body: unknown }>(
    "/v1/admin/expert-cards/:applicationId/review",
    { bodyLimit: 2048 },
    async (req, reply) => {
      if (
        !uuid.test(req.params.applicationId) ||
        !mutation(req.body, [
          "action",
          ...(object(req.body) && req.body.returnReason !== undefined
            ? ["returnReason"]
            : []),
          ...(object(req.body) && req.body.warningAcknowledgment !== undefined
            ? ["warningAcknowledgment"]
            : []),
        ]) ||
        !object(req.body) ||
        (req.body.action !== "approve" && req.body.action !== "return_changes")
      )
        return reply.code(400).send({ error: "invalid_request" });
      const body = req.body as {
        expectedRevision: number;
        idempotencyKey: string;
        action: "approve" | "return_changes";
        warningAcknowledgment?: string;
        returnReason?: string;
      };
      const result = await service.review(session(req.headers.authorization)!, {
        applicationId: req.params.applicationId,
        ...body,
      });
      return result.kind === "ok"
        ? result
        : reply.code(status(result.kind)).send({ error: result.kind });
    },
  );
  app.post<{ Params: { applicationId: string }; Body: unknown }>(
    "/v1/admin/expert-cards/:applicationId/promo-review",
    { bodyLimit: 2048 },
    async (req, reply) => {
      if (
        !uuid.test(req.params.applicationId) ||
        !mutation(req.body, []) ||
        !object(req.body)
      )
        return reply.code(400).send({ error: "invalid_request" });
      const body = req.body as {
        expectedRevision: number;
        idempotencyKey: string;
      };
      const result = await service.confirmPromo(
        session(req.headers.authorization)!,
        { applicationId: req.params.applicationId, ...body },
      );
      return result.kind === "ok"
        ? result
        : reply.code(status(result.kind)).send({ error: result.kind });
    },
  );
};
