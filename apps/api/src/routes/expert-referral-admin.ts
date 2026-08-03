import rateLimit from "@fastify/rate-limit";
import type { ExpertReferralAdminAction, ExpertReferralAdminPayload, ExpertReferralAdminService, ExpertReferralEnvironmentCeilings } from "@ii-tonya/application";
import { expertReferralAdminActions } from "@ii-tonya/application";
import type { AdminPayload, PostgresAdminApprovalRepository } from "@ii-tonya/db";
import Fastify from "fastify";
import { hashAdminSessionToken } from "./admin.js";

type ApprovalPort = Pick<PostgresAdminApprovalRepository, "resolvePrincipal" | "requestApproval" | "approveApproval">;
export interface ExpertReferralAdminApiDependencies {
  approvals: ApprovalPort;
  admin: ExpertReferralAdminService;
  environmentCeilings: ExpertReferralEnvironmentCeilings;
  sessionTokenHash?: (token: string) => string;
  rateLimitMax?: number;
}
const uuid = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const opaque = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$";
const objectTypes: Record<ExpertReferralAdminAction, string> = {
  "expert_referral.batch_generate": "expert",
  "expert_referral.code_revoke": "expert_referral_code",
  "expert_referral.issuance_override": "expert_referral_issuance_override",
  "expert_referral.abuse_hold_open": "expert",
  "expert_referral.abuse_hold_close": "expert",
  "expert_residency.tariff_create": "expert_residency_tariff_version",
  "expert_residency.tariff_retire": "expert_residency_tariff_version",
  "expert_referral.hold_replay": "expert",
  "expert_referral.feature_switch": "expert_referral_feature_control",
};
const params = { type: "object", additionalProperties: false, required: ["action", "objectId"], properties: { action: { type: "string", enum: expertReferralAdminActions }, objectId: { anyOf: [{ type: "string", pattern: uuid }, { const: "00000000-0000-0000-0000-000000000041" }] } } } as const;
const authBody = { type: "object", additionalProperties: false, required: ["nonce", "command"], properties: { nonce: { type: "string", pattern: opaque }, command: { type: "object", maxProperties: 8 } } } as const;
const executionBody = { type: "object", additionalProperties: false, required: ["approvalId", "nonce", "correlationId", "command"], properties: { approvalId: { type: "string", pattern: uuid }, secondApprovalId: { type: "string", pattern: uuid }, nonce: { type: "string", pattern: opaque }, secondNonce: { type: "string", pattern: opaque }, correlationId: { type: "string", pattern: opaque }, command: { type: "object", maxProperties: 8 } } } as const;
const bearer = (value: string | undefined): string | null => /^Bearer ([A-Za-z0-9._~-]{32,512})$/u.exec(value ?? "")?.[1] ?? null;
const exactKeys = (value: ExpertReferralAdminPayload, required: readonly string[], optional: readonly string[] = []): boolean => {
  const actual = Object.keys(value).sort(); const allowed = [...required, ...optional];
  return required.every((key) => actual.includes(key)) && actual.every((key) => allowed.includes(key));
};
const boundedText = (value: unknown, min = 1, max = 128): value is string => typeof value === "string" && value.length >= min && value.length <= max;
const safeInteger = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const canonicalPayload = (action: ExpertReferralAdminAction, objectId: string, raw: unknown, actor?: { id: string; sessionIdHash: string }): ExpertReferralAdminPayload => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw new Error("invalid_command");
  const p = raw as ExpertReferralAdminPayload;
  if (action === "expert_referral.batch_generate" && (!exactKeys(p,["count"],["overrideId"]) || !safeInteger(p.count,1,1000) || (p.overrideId !== undefined && !boundedText(p.overrideId)))) throw new Error("invalid_command");
  if ((action === "expert_referral.code_revoke" || action === "expert_referral.hold_replay") && !exactKeys(p,[])) throw new Error("invalid_command");
  if (action === "expert_referral.issuance_override" && (!exactKeys(p,["inviterExpertId","additionalQuota","reasonCode","validFrom","validUntil"]) || !boundedText(p.inviterExpertId) || !safeInteger(p.additionalQuota,1,1000) || !boundedText(p.reasonCode) || !boundedText(p.validFrom) || !boundedText(p.validUntil))) throw new Error("invalid_command");
  if ((action === "expert_referral.abuse_hold_open" || action === "expert_referral.abuse_hold_close") && (!exactKeys(p,["reasonCode"]) || !boundedText(p.reasonCode))) throw new Error("invalid_command");
  if (action === "expert_residency.tariff_create" && (!exactKeys(p,["tariffKey","displayName","priceMinor","durationSeconds","activeFrom","activeTo"]) || !boundedText(p.tariffKey) || !boundedText(p.displayName) || !safeInteger(p.priceMinor,1,999_999_999_999) || !safeInteger(p.durationSeconds,1,2_147_483_647) || !boundedText(p.activeFrom) || !boundedText(p.activeTo))) throw new Error("invalid_command");
  if (action === "expert_residency.tariff_retire" && (!exactKeys(p,["retiredAt"]) || !boundedText(p.retiredAt))) throw new Error("invalid_command");
  if (action === "expert_referral.feature_switch" && (!exactKeys(p,["expectedVersion","newCommandsEnabled","rewardGrantsEnabled"]) || !safeInteger(p.expectedVersion,0,2_147_483_646) || typeof p.newCommandsEnabled !== "boolean" || typeof p.rewardGrantsEnabled !== "boolean")) throw new Error("invalid_command");
  if (action === "expert_referral.batch_generate") return { ...p, inviterExpertId: objectId };
  if (action === "expert_referral.code_revoke") return { codeId: objectId };
  if (action === "expert_referral.issuance_override") {
    if (actor === undefined) throw new Error("invalid_command");
    return { ...p, overrideId: objectId, requesterId: actor.id, requesterSessionIdHash: actor.sessionIdHash };
  }
  if (action === "expert_referral.abuse_hold_open" || action === "expert_referral.abuse_hold_close") return { ...p, expertId: objectId };
  if (action === "expert_residency.tariff_create") return { ...p, tariffVersionId: objectId };
  if (action === "expert_residency.tariff_retire") return { ...p, tariffVersionId: objectId };
  if (action === "expert_referral.hold_replay") return { expertId: objectId };
  return p;
};

export const EXPERT_REFERRAL_ADMIN_LOG_REDACT_PATHS = ["req.headers.authorization", "request.headers.authorization", "headers.authorization", "body"] as const;
export async function buildExpertReferralAdminApi(deps: ExpertReferralAdminApiDependencies) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, ajv: { customOptions: { removeAdditional: false } } });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { validation?: unknown; statusCode?: number };
    if (e.validation !== undefined) return reply.code(400).send({ error: "invalid_request" });
    if (e.statusCode === 429) return reply.code(429).send({ error: "rate_limited" });
    return reply.code(500).send({ error: "internal_error" });
  });
  const limit = { max: deps.rateLimitMax ?? 20, timeWindow: "1 minute" };
  const principal = async (authorization: string | undefined) => {
    const token = bearer(authorization); if (token === null) return null;
    const hash = (deps.sessionTokenHash ?? hashAdminSessionToken)(token);
    const resolved = await deps.approvals.resolvePrincipal(hash);
    return resolved?.sessionIdHash === hash ? resolved : null;
  };
  app.post<{ Params: { action: ExpertReferralAdminAction; objectId: string }; Body: { nonce: string; command: unknown } }>("/v1/admin/actions/:action/:objectId/approvals", { schema: { params, body: authBody }, config: { rateLimit: limit } }, async (request, reply) => {
    const actor = await principal(request.headers.authorization); if (actor === null) return reply.code(401).send({ error: "unauthorized" });
    let payload: ExpertReferralAdminPayload; try { payload = canonicalPayload(request.params.action, request.params.objectId, request.body.command, actor); } catch { return reply.code(400).send({ error: "invalid_command" }); }
    const result = await deps.approvals.requestApproval({ sessionIdHash: actor.sessionIdHash, action: request.params.action, objectType: objectTypes[request.params.action], objectId: request.params.objectId, payload: payload as AdminPayload, nonce: request.body.nonce });
    return result === null ? reply.code(403).send({ error: "forbidden" }) : reply.code(201).send(result);
  });
  app.post<{ Params: { action: ExpertReferralAdminAction; objectId: string }; Body: { approvalId: string; secondApprovalId?: string; nonce: string; secondNonce?: string; correlationId: string; command: unknown } }>("/v1/admin/actions/:action/:objectId/execute", { schema: { params, body: executionBody }, config: { rateLimit: limit } }, async (request, reply) => {
    const actor = await principal(request.headers.authorization); if (actor === null) return reply.code(401).send({ error: "unauthorized" });
    let payload: ExpertReferralAdminPayload; try { payload = canonicalPayload(request.params.action, request.params.objectId, request.body.command, actor); } catch { return reply.code(400).send({ error: "invalid_command" }); }
    try {
      const result = await deps.admin.execute(actor, { action: request.params.action, objectId: request.params.objectId, approvalId: request.body.approvalId, ...(request.body.secondApprovalId === undefined ? {} : { secondApprovalId: request.body.secondApprovalId }), nonce: request.body.nonce, ...(request.body.secondNonce === undefined ? {} : { secondNonce: request.body.secondNonce }), correlationId: request.body.correlationId, payload, environmentCeilings: deps.environmentCeilings });
      return result.allowed ? reply.code(200).send(result) : reply.code(403).send({ error: result.reasonCode });
    } catch (error) {
      if ((error as Error).message === "invalid_admin_command") return reply.code(400).send({ error: "invalid_command" });
      if ((error as { code?: string }).code === "FEATURE_CONTROL_CONFLICT") return reply.code(409).send({ error: "conflict" });
      throw error;
    }
  });
  app.get<{ Querystring: { inviterExpertId: string } }>("/v1/admin/expert-referrals/inventory", { schema: { querystring: { type: "object", additionalProperties: false, required: ["inviterExpertId"], properties: { inviterExpertId: { type: "string", pattern: uuid } } } }, config: { rateLimit: limit } }, async (request, reply) => {
    const actor = await principal(request.headers.authorization); if (actor === null) return reply.code(401).send({ error: "unauthorized" });
    return reply.send(await deps.admin.inventory(actor, request.query.inviterExpertId));
  });
  return app;
}
