import type { ResolvedAdminPrincipal } from "@ii-tonya/db";
import {
  SandboxPaymentConflictError,
  sandboxApprovalObjectId,
  type SandboxTransitionWorkflowCommand,
} from "@ii-tonya/sandbox-payments";
import { hashAdminSessionToken } from "@ii-tonya/api";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { SandboxRuntimeDependencies } from "./server.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const paymentIdPattern = "^sandbox_payment_[A-Za-z0-9_-]{22,128}$";
const opaquePattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$";
const actionValues = [
  "expert_residency.sandbox_settle",
  "expert_residency.sandbox_refund",
] as const;
const transitionValues = ["settled", "refunded"] as const;

const paymentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["paymentId"],
  properties: { paymentId: { type: "string", pattern: paymentIdPattern } },
} as const;
const requestParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "paymentId"],
  properties: {
    action: { type: "string", enum: actionValues },
    paymentId: { type: "string", pattern: paymentIdPattern },
  },
} as const;
const approvalParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalId"],
  properties: { approvalId: { type: "string", pattern: uuidPattern } },
} as const;
const transitionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["paymentId", "transition"],
  properties: {
    paymentId: { type: "string", pattern: paymentIdPattern },
    transition: { type: "string", enum: transitionValues },
  },
} as const;
const requestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["nonce", "expectedVersion", "idempotencyKey"],
  properties: {
    nonce: { type: "string", pattern: opaquePattern },
    expectedVersion: { type: "integer", minimum: 0, maximum: 2_147_483_646 },
    idempotencyKey: { type: "string", pattern: opaquePattern },
  },
} as const;
const approvalBodySchema = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
} as const;
const transitionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "approvalId",
    "nonce",
    "expectedVersion",
    "idempotencyKey",
    "correlationId",
  ],
  properties: {
    approvalId: { type: "string", pattern: uuidPattern },
    nonce: { type: "string", pattern: opaquePattern },
    expectedVersion: { type: "integer", minimum: 0, maximum: 2_147_483_646 },
    idempotencyKey: { type: "string", pattern: opaquePattern },
    correlationId: { type: "string", pattern: opaquePattern },
  },
} as const;

function bearerToken(value: string | undefined): string | null {
  return /^Bearer ([A-Za-z0-9._~-]{32,512})$/u.exec(value ?? "")?.[1] ?? null;
}

async function principal(
  authorization: string | undefined,
  deps: SandboxRuntimeDependencies,
): Promise<ResolvedAdminPrincipal | null> {
  const token = bearerToken(authorization);
  if (token === null) return null;
  const sessionIdHash = hashAdminSessionToken(token);
  const resolved = await deps.approvals.resolvePrincipal(sessionIdHash);
  return resolved?.sessionIdHash === sessionIdHash ? resolved : null;
}

const transitionFromAction = (
  action: (typeof actionValues)[number],
): (typeof transitionValues)[number] =>
  action === "expert_residency.sandbox_settle" ? "settled" : "refunded";

const actionFromTransition = (
  transition: (typeof transitionValues)[number],
): SandboxTransitionWorkflowCommand["action"] =>
  transition === "settled"
    ? "expert_residency.sandbox_settle"
    : "expert_residency.sandbox_refund";

export async function buildSandboxRoutes(
  deps: SandboxRuntimeDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const safe = error as {
      readonly code?: string;
      readonly statusCode?: number;
      readonly validation?: unknown;
    };
    if (safe.validation !== undefined)
      return reply.code(400).send({ error: "invalid_request" });
    if (safe.statusCode === 413 || safe.code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(413).send({ error: "payload_too_large" });
    if (safe.statusCode === 429)
      return reply.code(429).send({ error: "rate_limited" });
    if (
      error instanceof SandboxPaymentConflictError ||
      safe.code === "SANDBOX_PAYMENT_CONFLICT"
    )
      return reply.code(409).send({ error: "conflict" });
    if (safe.code === "SANDBOX_DEPENDENCY_UNAVAILABLE")
      return reply.code(503).send({ error: "unavailable" });
    return reply.code(500).send({ error: "internal_error" });
  });
  const adminRateLimit = { max: 30, timeWindow: "1 minute" } as const;

  app.get<{ Params: { paymentId: string } }>(
    "/sandbox/v1/payments/:paymentId",
    { schema: { params: paymentParamsSchema } },
    async (request) => ({
      kind: "sandbox_checkout",
      paymentId: request.params.paymentId,
      mutable: false,
    }),
  );

  app.post<{
    Params: { action: (typeof actionValues)[number]; paymentId: string };
    Body: { nonce: string; expectedVersion: number; idempotencyKey: string };
  }>(
    "/sandbox/v1/admin/approvals/:action/:paymentId/request",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: adminRateLimit },
      schema: { params: requestParamsSchema, body: requestBodySchema },
    },
    async (request, reply) => {
      const requester = await principal(request.headers.authorization, deps);
      if (requester === null)
        return reply.code(401).send({ error: "unauthorized" });
      const transition = transitionFromAction(request.params.action);
      const result = await deps.approvals.requestApproval({
        sessionIdHash: requester.sessionIdHash,
        action: request.params.action,
        objectType: "sandbox_expert_residency_payment",
        objectId: sandboxApprovalObjectId(request.params.paymentId),
        payload: {
          paymentId: request.params.paymentId,
          transition,
          expectedVersion: request.body.expectedVersion,
          idempotencyKey: request.body.idempotencyKey,
        },
        nonce: request.body.nonce,
      });
      if (result === null) return reply.code(403).send({ error: "forbidden" });
      return reply.code(201).send({
        approvalId: result.approvalId,
        expiresAt: result.expiresAt.toISOString(),
      });
    },
  );

  app.post<{ Params: { approvalId: string }; Body: Record<string, never> }>(
    "/sandbox/v1/admin/approvals/:approvalId/approve",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: adminRateLimit },
      schema: { params: approvalParamsSchema, body: approvalBodySchema },
    },
    async (request, reply) => {
      const approver = await principal(request.headers.authorization, deps);
      if (approver === null)
        return reply.code(401).send({ error: "unauthorized" });
      const approved = await deps.approvals.approveApproval({
        approvalId: request.params.approvalId,
        sessionIdHash: approver.sessionIdHash,
      });
      return approved
        ? reply.code(200).send({ approved: true })
        : reply.code(403).send({ error: "forbidden" });
    },
  );

  app.post<{
    Params: {
      paymentId: string;
      transition: (typeof transitionValues)[number];
    };
    Body: {
      approvalId: string;
      nonce: string;
      expectedVersion: number;
      idempotencyKey: string;
      correlationId: string;
    };
  }>(
    "/sandbox/v1/admin/payments/:paymentId/transitions/:transition",
    {
      bodyLimit: 8 * 1024,
      config: { rateLimit: adminRateLimit },
      schema: { params: transitionParamsSchema, body: transitionBodySchema },
    },
    async (request, reply) => {
      const requester = await principal(request.headers.authorization, deps);
      if (requester === null)
        return reply.code(401).send({ error: "unauthorized" });
      const result = await deps.transitionWorkflow.execute({
        action: actionFromTransition(request.params.transition),
        paymentId: request.params.paymentId,
        approvalId: request.body.approvalId,
        nonce: request.body.nonce,
        sessionIdHash: requester.sessionIdHash,
        expectedVersion: request.body.expectedVersion,
        idempotencyKey: request.body.idempotencyKey,
        correlationId: request.body.correlationId,
      });
      if (!result.allowed) return reply.code(403).send({ error: "forbidden" });
      try {
        await deps.deliverPayment(request.params.paymentId);
      } catch {
        return reply.code(503).send({ error: "delivery_pending" });
      }
      return reply.code(200).send({
        replayed: result.replayed,
        event: result.event,
      });
    },
  );
  return app;
}
