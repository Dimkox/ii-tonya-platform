import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import type { AdminPrincipal, AdminService } from "@ii-tonya/application";
import type {
  AdminPayload,
  ApprovalAdminAction,
  PostgresAdminApprovalRepository,
} from "@ii-tonya/db";
import Fastify, { type FastifyInstance } from "fastify";

type ApprovalPort = Pick<
  PostgresAdminApprovalRepository,
  "resolvePrincipal" | "requestApproval" | "approveApproval"
>;

export interface AdminApiDependencies {
  readonly approvals: ApprovalPort;
  readonly admin: AdminService;
  readonly rateLimitMax?: number;
}

type CommandRecord = Readonly<Record<string, unknown>>;

const mutationActions = [
  "client.create",
  "client.deactivate",
  "package.grant",
  "package.intro_grant",
  "package.revoke",
  "expert.verify",
  "expert.suspend",
  "service.activate",
  "service.deactivate",
  "integration_error.resolve",
  "safety.resolve",
  "feedback.resolve",
] as const satisfies readonly ApprovalAdminAction[];

type MutationAction = (typeof mutationActions)[number];

const objectTypes: Readonly<Record<MutationAction, string>> = {
  "client.create": "user",
  "client.deactivate": "user",
  "package.grant": "user",
  "package.intro_grant": "user",
  "package.revoke": "user",
  "expert.verify": "expert",
  "expert.suspend": "expert",
  "service.activate": "service",
  "service.deactivate": "service",
  "integration_error.resolve": "integration_error",
  "safety.resolve": "safety_case",
  "feedback.resolve": "feedback_queue",
};

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const opaquePattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$";
const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "objectId"],
  properties: {
    action: { type: "string", enum: mutationActions },
    objectId: { type: "string", pattern: uuidPattern },
  },
} as const;
const approvalParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalId"],
  properties: { approvalId: { type: "string", pattern: uuidPattern } },
} as const;
const commandSchema = { type: "object", maxProperties: 3 } as const;
const requestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["nonce", "command"],
  properties: {
    nonce: { type: "string", pattern: opaquePattern },
    command: commandSchema,
  },
} as const;
const executionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalId", "nonce", "correlationId", "command"],
  properties: {
    approvalId: { type: "string", pattern: uuidPattern },
    nonce: { type: "string", pattern: opaquePattern },
    correlationId: { type: "string", pattern: opaquePattern },
    command: commandSchema,
  },
} as const;

export const ADMIN_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "request.headers.authorization",
  "headers.authorization",
  "body",
] as const;

export const hashAdminSessionToken = (token: string): string =>
  `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;

const isRecord = (value: unknown): value is CommandRecord =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (
  value: CommandRecord,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
};

const boundedString = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 8 &&
  value.length <= 128 &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);

function canonicalCommand(
  action: MutationAction,
  objectId: string,
  raw: unknown,
): AdminPayload {
  if (!isRecord(raw)) throw new Error("invalid_command");
  if (action === "client.create" || action === "client.deactivate") {
    if (!hasExactKeys(raw, [])) throw new Error("invalid_command");
    return { userId: objectId };
  }
  if (action === "package.grant") {
    if (
      !hasExactKeys(raw, ["idempotencyKey", "units"]) ||
      typeof raw.units !== "number" ||
      ![500, 1000, 1500, 2000].includes(raw.units) ||
      !boundedString(raw.idempotencyKey)
    )
      throw new Error("invalid_command");
    return {
      userId: objectId,
      units: raw.units,
      idempotencyKey: raw.idempotencyKey,
    };
  }
  if (action === "package.intro_grant") {
    if (
      !hasExactKeys(raw, ["idempotencyKey"]) ||
      !boundedString(raw.idempotencyKey)
    ) {
      throw new Error("invalid_command");
    }
    return { userId: objectId, units: 100, idempotencyKey: raw.idempotencyKey };
  }
  if (action === "package.revoke") {
    if (
      !hasExactKeys(raw, ["idempotencyKey", "packageId"]) ||
      !boundedString(raw.idempotencyKey) ||
      typeof raw.packageId !== "string" ||
      !new RegExp(uuidPattern, "u").test(raw.packageId)
    )
      throw new Error("invalid_command");
    return {
      userId: objectId,
      packageId: raw.packageId,
      idempotencyKey: raw.idempotencyKey,
    };
  }
  if (action === "expert.verify" || action === "expert.suspend") {
    if (!hasExactKeys(raw, [])) throw new Error("invalid_command");
    return { expertId: objectId, verified: action === "expert.verify" };
  }
  if (action === "service.activate" || action === "service.deactivate") {
    if (!hasExactKeys(raw, [])) throw new Error("invalid_command");
    return { serviceId: objectId, active: action === "service.activate" };
  }
  if (action === "integration_error.resolve") {
    if (!hasExactKeys(raw, [])) throw new Error("invalid_command");
    return { errorId: objectId };
  }
  if (
    !hasExactKeys(raw, ["resolution"]) ||
    (raw.resolution !== "acknowledge" && raw.resolution !== "resolve")
  ) {
    throw new Error("invalid_command");
  }
  return { alertId: objectId, resolution: raw.resolution };
}

function bearerToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/u.exec(value);
  return match?.[1] ?? null;
}

async function resolvePrincipal(
  authorization: string | undefined,
  approvals: ApprovalPort,
): Promise<AdminPrincipal | null> {
  const token = bearerToken(authorization);
  if (token === null) return null;
  const sessionIdHash = hashAdminSessionToken(token);
  const principal = await approvals.resolvePrincipal(sessionIdHash);
  return principal?.sessionIdHash === sessionIdHash ? principal : null;
}

async function execute(
  admin: AdminService,
  principal: AdminPrincipal,
  action: MutationAction,
  objectId: string,
  authorization: { approvalId: string; nonce: string; correlationId: string },
  payload: AdminPayload,
) {
  const base = { routeObjectId: objectId, ...authorization };
  const command = payload as Record<string, unknown>;
  switch (action) {
    case "client.create":
      return admin.createClient(principal, { ...base, userId: objectId });
    case "client.deactivate":
      return admin.deactivateClient(principal, { ...base, userId: objectId });
    case "package.grant":
      return admin.grantPackage(principal, {
        ...base,
        userId: objectId,
        units: command.units as number,
        idempotencyKey: command.idempotencyKey as string,
      });
    case "package.intro_grant":
      return admin.grantIntroPackage(principal, {
        ...base,
        userId: objectId,
        units: 100,
        idempotencyKey: command.idempotencyKey as string,
      });
    case "package.revoke":
      return admin.revokePackage(principal, {
        ...base,
        userId: objectId,
        packageId: command.packageId as string,
        idempotencyKey: command.idempotencyKey as string,
      });
    case "expert.verify":
      return admin.updateExpertVerification(principal, {
        ...base,
        expertId: objectId,
        verified: true,
      });
    case "expert.suspend":
      return admin.updateExpertVerification(principal, {
        ...base,
        expertId: objectId,
        verified: false,
      });
    case "service.activate":
      return admin.updateService(principal, {
        ...base,
        serviceId: objectId,
        active: true,
      });
    case "service.deactivate":
      return admin.updateService(principal, {
        ...base,
        serviceId: objectId,
        active: false,
      });
    case "integration_error.resolve":
      return admin.resolveIntegrationError(principal, {
        ...base,
        errorId: objectId,
      });
    case "safety.resolve":
      return admin.resolveAlert(principal, {
        ...base,
        alertId: objectId,
        alertType: "safety",
        resolution: command.resolution as "acknowledge" | "resolve",
      });
    case "feedback.resolve":
      return admin.resolveAlert(principal, {
        ...base,
        alertId: objectId,
        alertType: "feedback",
        resolution: command.resolution as "acknowledge" | "resolve",
      });
  }
}

export async function buildAdminApi(
  deps: AdminApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const safeError =
      typeof error === "object" && error !== null
        ? (error as {
            readonly validation?: unknown;
            readonly statusCode?: unknown;
          })
        : {};
    if (safeError.validation !== undefined) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (safeError.statusCode === 429) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });
  const rateLimitConfig = {
    max: deps.rateLimitMax ?? 30,
    timeWindow: "1 minute",
  };

  const latePaymentPath = "/v1/admin/expert-residency/late-payments";
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.split("?")[0]?.startsWith(latePaymentPath))
      reply.header("cache-control", "no-store");
    return payload;
  });
  const uuid = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.exec(
      value,
    )?.[0] === value;
  const cursorTime = (value: string) => {
    if (
      value.length !== 27 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value)
    )
      return false;
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString() === `${value.slice(0, 23)}Z`
    );
  };
  app.get<{ Querystring: Record<string, unknown> }>(
    latePaymentPath,
    { config: { rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (!principal) return reply.code(401).send({ error: "unauthorized" });
      if (!principal.roles.includes("support"))
        return reply.code(403).send({ error: "forbidden" });
      const q = request.query;
      if (
        Object.keys(q).some(
          (k) =>
            !["limit", "status", "beforeCreatedAt", "beforeId"].includes(k),
        ) ||
        typeof q.limit !== "string" ||
        /^(?:[1-9][0-9]?|100)$/u.exec(q.limit)?.[0] !== q.limit ||
        (q.status !== undefined &&
          q.status !== "open" &&
          q.status !== "resolved") ||
        (q.beforeId === undefined) !== (q.beforeCreatedAt === undefined) ||
        (q.beforeId !== undefined &&
          (typeof q.beforeId !== "string" || !uuid(q.beforeId))) ||
        (q.beforeCreatedAt !== undefined &&
          (typeof q.beforeCreatedAt !== "string" ||
            !cursorTime(q.beforeCreatedAt)))
      )
        return reply.code(400).send({ error: "invalid_request" });
      if (!deps.admin.listLatePayments)
        return reply.code(503).send({ error: "unavailable" });
      const result = await deps.admin.listLatePayments(principal, {
        limit: Number(q.limit),
        status: q.status ?? "open",
        ...(q.beforeId === undefined
          ? {}
          : {
              beforeId: q.beforeId as string,
              beforeCreatedAt: q.beforeCreatedAt as string,
            }),
      });
      if (!result.allowed)
        return reply
          .code(result.reasonCode === "unavailable" ? 503 : 403)
          .send({ error: result.reasonCode });
      return reply.send({ items: result.items });
    },
  );
  app.get<{
    Params: { errorId: string };
    Querystring: Record<string, unknown>;
  }>(
    `${latePaymentPath}/:errorId`,
    { config: { rateLimit: rateLimitConfig } },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (!principal) return reply.code(401).send({ error: "unauthorized" });
      if (!principal.roles.includes("support"))
        return reply.code(403).send({ error: "forbidden" });
      if (!uuid(request.params.errorId) || Object.keys(request.query).length)
        return reply.code(400).send({ error: "invalid_request" });
      if (!deps.admin.getLatePayment)
        return reply.code(503).send({ error: "unavailable" });
      const result = await deps.admin.getLatePayment(principal, {
        errorId: request.params.errorId,
      });
      if (!result.allowed)
        return reply
          .code(result.reasonCode === "unavailable" ? 503 : 403)
          .send({ error: result.reasonCode });
      if (!result.item) return reply.code(404).send({ error: "not_found" });
      return reply.send({ item: result.item });
    },
  );

  app.post<{
    Params: { action: MutationAction; objectId: string };
    Body: { nonce: string; command: unknown };
  }>(
    "/v1/admin/actions/:action/:objectId/approvals",
    {
      schema: { params: paramsSchema, body: requestBodySchema },
      config: { rateLimit: rateLimitConfig },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      let payload: AdminPayload;
      try {
        payload = canonicalCommand(
          request.params.action,
          request.params.objectId,
          request.body.command,
        );
      } catch {
        return reply.code(400).send({ error: "invalid_command" });
      }
      const requested = await deps.approvals.requestApproval({
        sessionIdHash: principal.sessionIdHash,
        action: request.params.action,
        objectType: objectTypes[request.params.action],
        objectId: request.params.objectId,
        payload,
        nonce: request.body.nonce,
      });
      if (requested === null)
        return reply.code(403).send({ error: "forbidden" });
      return reply.code(201).send(requested);
    },
  );

  app.post<{ Params: { approvalId: string }; Body: unknown }>(
    "/v1/admin/approvals/:approvalId/approve",
    {
      schema: { params: approvalParamsSchema },
      config: { rateLimit: rateLimitConfig },
    },
    async (request, reply) => {
      if (request.body !== undefined)
        return reply.code(400).send({ error: "invalid_request" });
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      const approved = await deps.approvals.approveApproval({
        approvalId: request.params.approvalId,
        sessionIdHash: principal.sessionIdHash,
      });
      return approved
        ? reply.code(204).send()
        : reply.code(403).send({ error: "forbidden" });
    },
  );

  app.post<{
    Params: { action: MutationAction; objectId: string };
    Body: {
      approvalId: string;
      nonce: string;
      correlationId: string;
      command: unknown;
    };
  }>(
    "/v1/admin/actions/:action/:objectId/execute",
    {
      schema: { params: paramsSchema, body: executionBodySchema },
      config: { rateLimit: rateLimitConfig },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      let payload: AdminPayload;
      try {
        payload = canonicalCommand(
          request.params.action,
          request.params.objectId,
          request.body.command,
        );
      } catch {
        return reply.code(400).send({ error: "invalid_command" });
      }
      const result = await execute(
        deps.admin,
        principal,
        request.params.action,
        request.params.objectId,
        {
          approvalId: request.body.approvalId,
          nonce: request.body.nonce,
          correlationId: request.body.correlationId,
        },
        payload,
      );
      return result.allowed
        ? reply.code(200).send(result)
        : reply.code(403).send({ error: result.reasonCode });
    },
  );

  return app;
}
