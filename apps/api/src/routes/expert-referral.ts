import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
} from "@ii-tonya/application";
import Fastify, { type FastifyInstance } from "fastify";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const expertCodePattern = "^EXR_[A-Za-z0-9_-]{22,128}$";
const idempotencyPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$";

const redeemBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "idempotencyKey"],
  properties: {
    code: { type: "string", pattern: expertCodePattern },
    idempotencyKey: { type: "string", pattern: idempotencyPattern },
  },
} as const;

const quoteBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["tariffVersionId"],
  properties: {
    tariffVersionId: { type: "string", pattern: uuidPattern },
  },
} as const;

const checkoutBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["tariffVersionId", "idempotencyKey"],
  properties: {
    tariffVersionId: { type: "string", pattern: uuidPattern },
    idempotencyKey: { type: "string", pattern: idempotencyPattern },
  },
} as const;

export interface ExpertPrincipalResolver {
  resolve(
    authorization: string | undefined,
  ): Promise<ExpertPrincipal | null>;
}

export interface ExpertReferralApiDependencies {
  readonly principals: ExpertPrincipalResolver;
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
}

const resultKind = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "kind" in value
    ? typeof (value as { kind?: unknown }).kind === "string"
      ? (value as { kind: string }).kind
      : undefined
    : undefined;

const sendServiceResult = (
  reply: Parameters<Parameters<FastifyInstance["get"]>[1]>[1],
  result: unknown,
) => {
  const kind = resultKind(result);
  if (kind === "forbidden") {
    return reply.code(403).send({ error: "forbidden" });
  }
  if (kind === "disabled") {
    return reply.code(503).send({ error: "feature_disabled" });
  }
  return reply.send(result);
};

export async function buildExpertReferralApi(
  deps: ExpertReferralApiDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 8 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as {
      readonly validation?: unknown;
      readonly statusCode?: unknown;
    };
    if (candidate.validation !== undefined) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return reply.code(409).send({ error: "command_rejected" });
  });

  const principalFor = async (
    authorization: string | undefined,
  ): Promise<ExpertPrincipal | null> => {
    const principal = await deps.principals.resolve(authorization);
    return principal?.authenticated === true ? principal : null;
  };

  app.post(
    "/v1/expert/referrals/redeem",
    { schema: { body: redeemBodySchema } },
    async (request, reply) => {
      const principal = await principalFor(request.headers.authorization);
      if (principal === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const body = request.body as {
        code: string;
        idempotencyKey: string;
      };
      const result = await deps.referrals.redeemCode(
        principal,
        body.code,
        body.idempotencyKey,
      );
      return sendServiceResult(reply, result);
    },
  );

  app.get("/v1/expert/referrals/summary", async (request, reply) => {
    const principal = await principalFor(request.headers.authorization);
    if (principal === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const result = await deps.referrals.summary(principal);
    return sendServiceResult(reply, result);
  });

  app.post(
    "/v1/expert/residency/quotes",
    { schema: { body: quoteBodySchema } },
    async (request, reply) => {
      const principal = await principalFor(request.headers.authorization);
      if (principal === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const body = request.body as { tariffVersionId: string };
      const result = await deps.residency.quote(
        principal,
        body.tariffVersionId,
      );
      return sendServiceResult(reply, result);
    },
  );

  app.post(
    "/v1/expert/residency/checkouts",
    { schema: { body: checkoutBodySchema } },
    async (request, reply) => {
      const principal = await principalFor(request.headers.authorization);
      if (principal === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const body = request.body as {
        tariffVersionId: string;
        idempotencyKey: string;
      };
      const result = await deps.residency.checkout(
        principal,
        body.tariffVersionId,
        body.idempotencyKey,
      );
      return sendServiceResult(reply, result);
    },
  );

  return app;
}
