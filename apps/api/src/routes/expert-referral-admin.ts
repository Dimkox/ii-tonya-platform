import rateLimit from "@fastify/rate-limit";
import {
  EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID,
  ExpertReferralAdminServiceError,
  type AdminPrincipal,
  type ExpertReferralAdminService,
} from "@ii-tonya/application";
import type {
  AdminPayload,
  ExpertReferralApprovalAction,
  PostgresAdminApprovalRepository,
} from "@ii-tonya/db";
import Fastify, { type FastifyInstance } from "fastify";
import { hashAdminSessionToken } from "./admin.js";

type ApprovalPort = Pick<
  PostgresAdminApprovalRepository,
  "resolvePrincipal" | "requestApproval" | "approveApproval"
>;

export interface ExpertReferralAdminApiDependencies {
  readonly approvals: ApprovalPort;
  readonly admin: ExpertReferralAdminService;
  readonly rateLimitMax?: number;
}

export const EXPERT_REFERRAL_ADMIN_LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "request.headers.authorization",
  "headers.authorization",
  "body",
] as const;

const actions = [
  "expert_referral.batch_generate",
  "expert_referral.code_revoke",
  "expert_referral.issuance_override",
  "expert_referral.abuse_hold_open",
  "expert_referral.abuse_hold_close",
  "expert_residency.tariff_create",
  "expert_residency.tariff_retire",
  "expert_referral.hold_replay",
  "expert_referral.feature_switch",
] as const satisfies readonly ExpertReferralApprovalAction[];

const objectTypes: Readonly<Record<ExpertReferralApprovalAction, string>> = {
  "expert_referral.batch_generate": "expert",
  "expert_referral.code_revoke": "expert_referral_code",
  "expert_referral.issuance_override": "expert",
  "expert_referral.abuse_hold_open": "expert",
  "expert_referral.abuse_hold_close": "expert",
  "expert_residency.tariff_create": "expert",
  "expert_residency.tariff_retire": "expert",
  "expert_referral.hold_replay": "expert_residency_order",
  "expert_referral.feature_switch": "expert_referral_feature_control",
};

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const opaquePattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$";
const paramsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action", "objectId"],
  properties: {
    action: { type: "string", enum: actions },
    objectId: { type: "string", pattern: uuidPattern },
  },
} as const;
const approvalParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalId"],
  properties: { approvalId: { type: "string", pattern: uuidPattern } },
} as const;
const inventoryParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["inviterExpertId"],
  properties: { inviterExpertId: { type: "string", pattern: uuidPattern } },
} as const;
const commandSchema = {
  type: "object",
  minProperties: 0,
  maxProperties: 12,
} as const;
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
  required: ["approvalId", "nonce", "command"],
  properties: {
    approvalId: { type: "string", pattern: uuidPattern },
    nonce: { type: "string", pattern: opaquePattern },
    command: commandSchema,
  },
} as const;

type CommandRecord = Readonly<Record<string, unknown>>;

interface ParsedCommand {
  readonly payload: AdminPayload;
  readonly values: CommandRecord;
}

const isRecord = (value: unknown): value is CommandRecord =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (
  value: CommandRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const actual = Object.keys(value);
  return (
    required.every((key) => actual.includes(key)) &&
    actual.every((key) => required.includes(key) || optional.includes(key))
  );
};

const uuid = (value: unknown): value is string =>
  typeof value === "string" && new RegExp(uuidPattern, "u").test(value);

const opaque = (value: unknown): value is string =>
  typeof value === "string" && new RegExp(opaquePattern, "u").test(value);

const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maximum;

const reasonCode = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value);

const isoDate = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  ) {
    return false;
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
};

function parseCommand(
  action: ExpertReferralApprovalAction,
  objectId: string,
  raw: unknown,
  execution: boolean,
): ParsedCommand {
  if (!isRecord(raw)) throw new Error("invalid_command");
  if (action === "expert_referral.batch_generate") {
    if (
      !hasExactKeys(raw, ["count"], ["overrideId"]) ||
      !Number.isInteger(raw.count) ||
      (raw.count as number) < 1 ||
      (raw.count as number) > 1000 ||
      (raw.overrideId !== undefined && !uuid(raw.overrideId))
    )
      throw new Error("invalid_command");
    const payload = {
      count: raw.count as number,
      overrideId: raw.overrideId ?? null,
    };
    return { payload, values: payload };
  }
  if (action === "expert_referral.code_revoke") {
    if (!hasExactKeys(raw, ["reasonCode"]) || !reasonCode(raw.reasonCode)) {
      throw new Error("invalid_command");
    }
    return { payload: { reasonCode: raw.reasonCode }, values: raw };
  }
  if (action === "expert_referral.issuance_override") {
    const required = [
      "inviterExpertId",
      "additionalQuota",
      "reason",
      "validFrom",
      "expiresAt",
    ];
    const executionKeys = execution ? ["secondApprovalId", "secondNonce"] : [];
    if (
      !hasExactKeys(raw, [...required, ...executionKeys]) ||
      !uuid(raw.inviterExpertId) ||
      !Number.isInteger(raw.additionalQuota) ||
      (raw.additionalQuota as number) < 1 ||
      (raw.additionalQuota as number) > 1000 ||
      !boundedText(raw.reason, 200) ||
      !isoDate(raw.validFrom) ||
      !isoDate(raw.expiresAt) ||
      Date.parse(raw.expiresAt) <= Date.parse(raw.validFrom) ||
      (execution && (!uuid(raw.secondApprovalId) || !opaque(raw.secondNonce)))
    )
      throw new Error("invalid_command");
    const payload = {
      inviterExpertId: raw.inviterExpertId as string,
      additionalQuota: raw.additionalQuota as number,
      reason: raw.reason as string,
      validFrom: raw.validFrom as string,
      expiresAt: raw.expiresAt as string,
    };
    return { payload, values: raw };
  }
  if (
    action === "expert_referral.abuse_hold_open" ||
    action === "expert_referral.abuse_hold_close"
  ) {
    if (!hasExactKeys(raw, ["reasonCode"]) || !reasonCode(raw.reasonCode)) {
      throw new Error("invalid_command");
    }
    return { payload: { reasonCode: raw.reasonCode }, values: raw };
  }
  if (action === "expert_residency.tariff_create") {
    if (
      !hasExactKeys(raw, [
        "tariffKey",
        "version",
        "displayName",
        "description",
        "priceMinor",
        "durationSeconds",
        "activeFrom",
        "activeTo",
      ]) ||
      !boundedText(raw.tariffKey, 128) ||
      !Number.isSafeInteger(raw.version) ||
      (raw.version as number) < 1 ||
      !boundedText(raw.displayName, 200) ||
      !boundedText(raw.description, 500) ||
      typeof raw.priceMinor !== "string" ||
      !/^[1-9][0-9]{0,18}$/u.test(raw.priceMinor) ||
      !Number.isSafeInteger(raw.durationSeconds) ||
      (raw.durationSeconds as number) < 86_400 ||
      (raw.durationSeconds as number) > 315_360_000 ||
      !isoDate(raw.activeFrom) ||
      (raw.activeTo !== null && !isoDate(raw.activeTo)) ||
      (typeof raw.activeTo === "string" &&
        Date.parse(raw.activeTo) <= Date.parse(raw.activeFrom))
    )
      throw new Error("invalid_command");
    return { payload: raw as AdminPayload, values: raw };
  }
  if (action === "expert_residency.tariff_retire") {
    if (!hasExactKeys(raw, ["activeTo"]) || !isoDate(raw.activeTo)) {
      throw new Error("invalid_command");
    }
    return { payload: { activeTo: raw.activeTo }, values: raw };
  }
  if (action === "expert_referral.hold_replay") {
    if (!hasExactKeys(raw, ["expertId"]) || !uuid(raw.expertId)) {
      throw new Error("invalid_command");
    }
    return { payload: { expertId: raw.expertId }, values: raw };
  }
  if (
    objectId !== EXPERT_REFERRAL_FEATURE_CONTROL_OBJECT_ID ||
    !hasExactKeys(raw, [
      "expectedVersion",
      "newCommandsEnabled",
      "rewardGrantsEnabled",
    ]) ||
    !Number.isSafeInteger(raw.expectedVersion) ||
    (raw.expectedVersion as number) < 0 ||
    typeof raw.newCommandsEnabled !== "boolean" ||
    typeof raw.rewardGrantsEnabled !== "boolean"
  )
    throw new Error("invalid_command");
  return { payload: raw as AdminPayload, values: raw };
}

function bearerToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  return /^Bearer ([A-Za-z0-9._~-]{32,512})$/u.exec(value)?.[1] ?? null;
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

const baseAuthorization = (
  body: { approvalId: string; nonce: string },
  routeObjectId: string,
) => ({
  routeObjectId,
  approvalId: body.approvalId,
  nonce: body.nonce,
});

async function execute(
  admin: ExpertReferralAdminService,
  principal: AdminPrincipal,
  action: ExpertReferralApprovalAction,
  objectId: string,
  body: { approvalId: string; nonce: string },
  values: CommandRecord,
): Promise<unknown> {
  const auth = baseAuthorization(body, objectId);
  switch (action) {
    case "expert_referral.batch_generate": {
      const batch = await admin.issueBatch(principal, {
        ...auth,
        inviterExpertId: objectId,
        count: values.count as number,
        ...(values.overrideId === null
          ? {}
          : { overrideId: values.overrideId as string }),
      });
      return {
        batchId: batch.batchId,
        codes: batch.codes.map((code) => code.plaintext),
      };
    }
    case "expert_referral.code_revoke":
      return admin.revokeCode(principal, {
        ...auth,
        codeId: objectId,
        reasonCode: values.reasonCode as string,
      });
    case "expert_referral.issuance_override":
      return admin.createIssuanceOverride(principal, {
        ...auth,
        overrideId: objectId,
        inviterExpertId: values.inviterExpertId as string,
        additionalQuota: values.additionalQuota as number,
        reason: values.reason as string,
        validFrom: new Date(values.validFrom as string),
        expiresAt: new Date(values.expiresAt as string),
        secondApprovalId: values.secondApprovalId as string,
        secondNonce: values.secondNonce as string,
      });
    case "expert_referral.abuse_hold_open":
      return admin.openAbuseHold(principal, {
        ...auth,
        expertId: objectId,
        reasonCode: values.reasonCode as string,
      });
    case "expert_referral.abuse_hold_close":
      return admin.closeAbuseHold(principal, {
        ...auth,
        expertId: objectId,
        reasonCode: values.reasonCode as string,
      });
    case "expert_residency.tariff_create":
      return admin.createTariffVersion(principal, {
        ...auth,
        tariffVersionId: objectId,
        tariffKey: values.tariffKey as string,
        version: values.version as number,
        displayName: values.displayName as string,
        description: values.description as string,
        priceMinor: values.priceMinor as string,
        durationSeconds: values.durationSeconds as number,
        activeFrom: new Date(values.activeFrom as string),
        activeTo:
          values.activeTo === null ? null : new Date(values.activeTo as string),
      });
    case "expert_residency.tariff_retire":
      await admin.retireTariffVersion(principal, {
        ...auth,
        tariffVersionId: objectId,
        activeTo: new Date(values.activeTo as string),
      });
      return { retired: true };
    case "expert_referral.hold_replay":
      return admin.replayHeldReward(principal, {
        ...auth,
        expertId: values.expertId as string,
        qualifyingOrderId: objectId,
      });
    case "expert_referral.feature_switch":
      return admin.updateFeatureControl(principal, {
        ...auth,
        expectedVersion: values.expectedVersion as number,
        newCommandsEnabled: values.newCommandsEnabled as boolean,
        rewardGrantsEnabled: values.rewardGrantsEnabled as boolean,
      });
  }
}

function publicError(error: unknown): { statusCode: number; code: string } {
  if (error instanceof ExpertReferralAdminServiceError) {
    return { statusCode: error.statusCode, code: error.code };
  }
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "";
  if (code.startsWith("invalid_"))
    return { statusCode: 400, code: "invalid_command" };
  if (code === "admin_evidence_invalid")
    return { statusCode: 403, code: "forbidden" };
  if (code.includes("disabled"))
    return { statusCode: 403, code: "feature_disabled" };
  return { statusCode: 409, code: "operation_denied" };
}

export async function buildExpertReferralAdminApi(
  deps: ExpertReferralAdminApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, _request, reply) => {
    const safeError = error as { validation?: unknown; statusCode?: unknown };
    if (safeError.validation !== undefined) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (safeError.statusCode === 429) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    const mapped = publicError(error);
    return reply.code(mapped.statusCode).send({ error: mapped.code });
  });
  const limit = { max: deps.rateLimitMax ?? 30, timeWindow: "1 minute" };

  app.post<{
    Params: { action: ExpertReferralApprovalAction; objectId: string };
    Body: { nonce: string; command: unknown };
  }>(
    "/v1/admin/expert-referrals/actions/:action/:objectId/approvals",
    {
      schema: { params: paramsSchema, body: requestBodySchema },
      config: { rateLimit: limit },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      let parsed: ParsedCommand;
      try {
        parsed = parseCommand(
          request.params.action,
          request.params.objectId,
          request.body.command,
          false,
        );
      } catch {
        return reply.code(400).send({ error: "invalid_command" });
      }
      const result = await deps.approvals.requestApproval({
        sessionIdHash: principal.sessionIdHash,
        action: request.params.action,
        objectType: objectTypes[request.params.action],
        objectId: request.params.objectId,
        payload: parsed.payload,
        nonce: request.body.nonce,
      });
      return result === null
        ? reply.code(403).send({ error: "forbidden" })
        : reply.code(201).send(result);
    },
  );

  app.post<{ Params: { approvalId: string }; Body: unknown }>(
    "/v1/admin/expert-referrals/approvals/:approvalId/approve",
    { schema: { params: approvalParamsSchema }, config: { rateLimit: limit } },
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
    Params: { action: ExpertReferralApprovalAction; objectId: string };
    Body: {
      approvalId: string;
      nonce: string;
      command: unknown;
    };
  }>(
    "/v1/admin/expert-referrals/actions/:action/:objectId/execute",
    {
      schema: { params: paramsSchema, body: executionBodySchema },
      config: { rateLimit: limit },
    },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      let parsed: ParsedCommand;
      try {
        parsed = parseCommand(
          request.params.action,
          request.params.objectId,
          request.body.command,
          true,
        );
      } catch {
        return reply.code(400).send({ error: "invalid_command" });
      }
      const result = await execute(
        deps.admin,
        principal,
        request.params.action,
        request.params.objectId,
        request.body,
        parsed.values,
      );
      return reply.code(200).send(result);
    },
  );

  app.get<{ Params: { inviterExpertId: string } }>(
    "/v1/admin/expert-referrals/inviters/:inviterExpertId/inventory",
    { schema: { params: inventoryParamsSchema }, config: { rateLimit: limit } },
    async (request, reply) => {
      const principal = await resolvePrincipal(
        request.headers.authorization,
        deps.approvals,
      );
      if (principal === null)
        return reply.code(401).send({ error: "unauthorized" });
      return reply
        .code(200)
        .send(
          await deps.admin.maskedInventory(
            principal,
            request.params.inviterExpertId,
          ),
        );
    },
  );

  return app;
}
