import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import type { ResolvedAdminPrincipal } from "@ii-tonya/db";
import { hashAdminSessionToken } from "./admin.js";

type Choice = "grant" | "revoke";
type Principal = { readonly actorId: string; readonly sessionIdHash: string };
type Command = Principal & {
  readonly approvalId: string;
  readonly nonce: string;
};
export interface OwnerPricingApprovedDependencies {
  readonly approvals: {
    resolvePrincipal(hash: string): Promise<ResolvedAdminPrincipal | null>;
    requestApproval(input: {
      action: "owner_test_pricing.grant" | "owner_test_pricing.revoke";
      objectType: string;
      objectId: string;
      payload: { userId: string } | { grantId: string };
      nonce: string;
      sessionIdHash: string;
    }): Promise<{ approvalId: string; expiresAt: Date } | null>;
    approveApproval(input: {
      approvalId: string;
      sessionIdHash: string;
    }): Promise<boolean>;
  };
  readonly workflow: {
    grant(
      input: Command & { userId: string },
    ): Promise<{ grantId: string } | null>;
    revoke(
      input: Command & { grantId: string },
    ): Promise<{ grantId: string } | null>;
  };
  readonly sessionTokenHash?: (token: string) => string;
  readonly rateLimitMax?: number;
}
const uuid =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const properties = {
  action: { type: "string", enum: ["grant", "revoke"] },
  objectId: { type: "string", pattern: uuid },
  nonce: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$" },
};
const body = (execute: boolean) => ({
  type: "object",
  additionalProperties: false,
  required: execute
    ? ["action", "objectId", "nonce", "approvalId"]
    : ["action", "objectId", "nonce"],
  properties: {
    ...properties,
    ...(execute ? { approvalId: { type: "string", pattern: uuid } } : {}),
  },
});
export const ownerPricingApprovedRoutes: FastifyPluginAsync<
  OwnerPricingApprovedDependencies
> = async (app, deps) => {
  await app.register(rateLimit, { global: false });
  const limit = { max: deps.rateLimitMax ?? 20, timeWindow: "1 minute" };
  const principal = async (header: string | undefined) => {
    const token = /^Bearer ([A-Za-z0-9._~-]{32,512})$/u.exec(header ?? "")?.[1];
    if (!token) return null;
    const hash = (deps.sessionTokenHash ?? hashAdminSessionToken)(token);
    const result = await deps.approvals.resolvePrincipal(hash);
    return result?.sessionIdHash === hash ? result : null;
  };
  app.post<{ Body: { action: Choice; objectId: string; nonce: string } }>(
    "/v1/admin/owner-test-pricing/approvals",
    { schema: { body: body(false) }, config: { rateLimit: limit } },
    async (req, reply) => {
      const actor = await principal(req.headers.authorization);
      if (!actor) return reply.code(401).send({ error: "unauthorized" });
      if (!actor.roles.includes("security_admin"))
        return reply.code(403).send({ error: "forbidden" });
      const { action, objectId, nonce } = req.body;
      const result = await deps.approvals.requestApproval({
        action:
          action === "grant"
            ? "owner_test_pricing.grant"
            : "owner_test_pricing.revoke",
        objectType: action === "grant" ? "user" : "owner_test_pricing_grant",
        objectId,
        payload:
          action === "grant" ? { userId: objectId } : { grantId: objectId },
        nonce,
        sessionIdHash: actor.sessionIdHash,
      });
      return result
        ? reply.code(201).send(result)
        : reply.code(403).send({ error: "forbidden" });
    },
  );
  app.post<{ Params: { approvalId: string }; Body: Record<string, never> }>(
    "/v1/admin/owner-test-pricing/approvals/:approvalId/approve",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["approvalId"],
          properties: { approvalId: { type: "string", pattern: uuid } },
        },
        body: { type: "object", additionalProperties: false, maxProperties: 0 },
      },
      config: { rateLimit: limit },
    },
    async (req, reply) => {
      const actor = await principal(req.headers.authorization);
      if (!actor) return reply.code(401).send({ error: "unauthorized" });
      if (!actor.roles.includes("security_admin"))
        return reply.code(403).send({ error: "forbidden" });
      const approved = await deps.approvals.approveApproval({
        approvalId: req.params.approvalId,
        sessionIdHash: actor.sessionIdHash,
      });
      return approved
        ? reply.send({ approved: true })
        : reply.code(403).send({ error: "forbidden" });
    },
  );
  app.post<{
    Body: {
      action: Choice;
      objectId: string;
      nonce: string;
      approvalId: string;
    };
  }>(
    "/v1/admin/owner-test-pricing/execute",
    { schema: { body: body(true) }, config: { rateLimit: limit } },
    async (req, reply) => {
      const actor = await principal(req.headers.authorization);
      if (!actor) return reply.code(401).send({ error: "unauthorized" });
      if (!actor.roles.includes("security_admin"))
        return reply.code(403).send({ error: "forbidden" });
      const { action, objectId, nonce, approvalId } = req.body;
      const command = {
        actorId: actor.id,
        sessionIdHash: actor.sessionIdHash,
        nonce,
        approvalId,
      };
      let result: { grantId: string } | null;
      try {
        result =
          action === "grant"
            ? await deps.workflow.grant({ ...command, userId: objectId })
            : await deps.workflow.revoke({ ...command, grantId: objectId });
      } catch (error) {
        if ((error as Error).message === "owner_test_pricing_conflict")
          return reply.code(409).send({ error: "conflict" });
        throw error;
      }
      return result
        ? reply.send(result)
        : reply.code(403).send({ error: "forbidden" });
    },
  );
};
