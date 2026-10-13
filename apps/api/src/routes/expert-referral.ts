import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
  ExpertCampaignService,
  PayerReceiptRequiredCampaignService,
  PayerReceiptCaptureService,
} from "@ii-tonya/application";
import {
  expertCampaignQuoteRequestSchema,
  expertCampaignCheckoutRequestSchema,
  payerReceiptCheckoutRequestSchema,
} from "@ii-tonya/application";
import { readExactAuthorization } from "../authorization-header.js";
import { createWindowedRateLimiter } from "../rate-limit.js";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { ExpertPrincipalResolver } from "../expert-principal-resolver.js";

export type { ExpertPrincipalResolver } from "../expert-principal-resolver.js";

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

export interface ExpertReferralApiDependencies {
  readonly receiptCapture?: PayerReceiptCaptureService;
  readonly principals: ExpertPrincipalResolver;
  readonly referrals: ExpertReferralService;
  readonly residency:
    | (Pick<
        ExpertResidencyService,
        "listActiveTariffs" | "quote" | "checkout"
      > & {
        readonly kind?: "legacy";
        readonly reconciliation?: ExpertResidencyService["reconciliation"];
      })
    | ExpertCampaignService
    | PayerReceiptRequiredCampaignService;
}

interface ExpertReferralRouteOptions extends ExpertReferralApiDependencies {
  readonly enabled?: {
    readonly expertReferral: boolean;
    readonly expertResidencyBilling: boolean;
  };
}

const isExpertCommandError = (error: unknown): boolean =>
  error instanceof Error &&
  typeof (error as Error & { readonly code?: unknown }).code === "string" &&
  /^EXPERT_(?:REFERRAL|RESIDENCY)_/u.test(
    (error as Error & { readonly code: string }).code,
  );

export async function expertReferralRoutes(
  app: FastifyInstance,
  deps: ExpertReferralRouteOptions,
): Promise<void> {
  const limiter = createWindowedRateLimiter();
  if ("receiptRequired" in deps.residency) {
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_request, body, done) => {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(
            body as Buffer,
          );
          const value: unknown = JSON.parse(text);
          if (!value || typeof value !== "object" || Array.isArray(value))
            return done(null, null);
          const names = [...text.matchAll(/("(?:\\.|[^"\\])*")\s*:/gu)].map(
            (m) => JSON.parse(m[1]!) as string,
          );
          return done(
            null,
            names.length === Object.keys(value).length &&
              new Set(names).size === names.length
              ? value
              : null,
          );
        } catch {
          return done(null, null);
        }
      },
    );
  }
  app.addHook("onRequest", async (request, reply) => {
    reply.header("cache-control", "no-store").header("pragma", "no-cache");
    const count = request.raw.rawHeaders.filter(
      (h, i) => i % 2 === 0 && h.toLowerCase() === "authorization",
    ).length;
    if (count > 1 || request.headers.authorization?.includes(","))
      return reply.code(400).send({ error: "invalid_request" });
    if (
      !limiter.consume("global", 600, 60000) ||
      !limiter.consume(`ip:${request.ip}`, 60, 60000)
    )
      return reply.code(429).send({ error: "rate_limited" });
    if (readExactAuthorization(request.raw.rawHeaders) === null)
      return reply.code(401).send({ error: "unauthorized" });
  });
  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as {
      readonly validation?: unknown;
      readonly statusCode?: unknown;
    };
    if (candidate.validation !== undefined) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (candidate.statusCode === 413) {
      return reply.code(413).send({ error: "payload_too_large" });
    }
    if (isExpertCommandError(error)) {
      return reply.code(409).send({ error: "command_rejected" });
    }
    if (
      typeof candidate.statusCode === "number" &&
      candidate.statusCode >= 400 &&
      candidate.statusCode < 500
    ) {
      return reply
        .code(candidate.statusCode)
        .send({ error: "request_rejected" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  const enabled = deps.enabled ?? {
    expertReferral: true,
    expertResidencyBilling: true,
  };

  const principalFor = async (
    authorization: string | undefined,
  ): Promise<ExpertPrincipal | null> => {
    const principal = await deps.principals.resolve(authorization);
    return principal?.authenticated === true ? principal : null;
  };

  if (enabled.expertReferral) {
    app.post(
      "/v1/expert/referrals/redeem",
      { bodyLimit: 8 * 1024, schema: { body: redeemBodySchema } },
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
  }

  if (enabled.expertResidencyBilling) {
    app.get("/v1/expert/residency/tariffs", async (request, reply) => {
      const principal = await principalFor(request.headers.authorization);
      if (principal === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const result = await deps.residency.listActiveTariffs(principal);
      return sendServiceResult(reply, result);
    });

    app.post(
      "/v1/expert/residency/quotes",
      {
        bodyLimit: 8 * 1024,
        ...(deps.residency.kind === "campaign"
          ? {}
          : { schema: { body: quoteBodySchema } }),
      },
      async (request, reply) => {
        const principal = await principalFor(request.headers.authorization);
        if (principal === null) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        if (deps.residency.kind === "campaign") {
          const parsed = expertCampaignQuoteRequestSchema.safeParse(
            request.body,
          );
          if (!parsed.success)
            return reply.code(400).send({ error: "invalid_request" });
          return sendServiceResult(
            reply,
            await deps.residency.quote(principal, parsed.data),
          );
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
      {
        bodyLimit: 8 * 1024,
        ...(deps.residency.kind === "campaign"
          ? {}
          : { schema: { body: checkoutBodySchema } }),
      },
      async (request, reply) => {
        const principal = await principalFor(request.headers.authorization);
        if (principal === null) {
          return reply.code(401).send({ error: "unauthorized" });
        }
        if (deps.residency.kind === "campaign") {
          const parsed = (
            "receiptRequired" in deps.residency
              ? payerReceiptCheckoutRequestSchema
              : expertCampaignCheckoutRequestSchema
          ).safeParse(request.body);
          if (!parsed.success)
            return reply.code(400).send({ error: "invalid_request" });
          return sendServiceResult(
            reply,
            await deps.residency.checkout(principal, parsed.data),
          );
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
  }
}

const resultKind = (value: unknown): string | undefined =>
  typeof value === "object" && value !== null && "kind" in value
    ? typeof (value as { kind?: unknown }).kind === "string"
      ? (value as { kind: string }).kind
      : undefined
    : undefined;

const sendServiceResult = (reply: FastifyReply, result: unknown) => {
  const kind = resultKind(result);
  if (kind === "invalid_request") return reply.code(400).send({ error: kind });
  if (kind === "command_rejected") return reply.code(409).send({ error: kind });
  if (kind === "payment_unavailable" || kind === "service_unavailable")
    return reply.code(503).send({ error: kind });
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
  await app.register(expertReferralRoutes, deps);

  return app;
}
