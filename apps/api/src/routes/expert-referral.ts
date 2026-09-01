import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
  ResidencyQuote,
} from "@ii-tonya/application";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { RateLimitGate } from "../rate-limit.js";

const uuid =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const boundedIdentifier = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
const decimalMinor = /^(?:0|[1-9][0-9]{0,18})$/u;

export interface ExpertHttpAuthentication {
  resolvePrincipal(token: string): Promise<ExpertPrincipal | null>;
}

export interface ExpertTariffVersionBinding {
  tariffKeyFor(tariffVersionId: string): Promise<string | null>;
}

export interface ExpertReferralRouteDependencies {
  readonly authentication: ExpertHttpAuthentication;
  readonly referrals: ExpertReferralService;
  readonly residency: ExpertResidencyService;
  readonly tariffVersions: ExpertTariffVersionBinding;
  readonly checkoutDeadline: () => Date;
  readonly rateLimiter: RateLimitGate;
  readonly redeemLimit?: number;
}

const bearerToken = (request: FastifyRequest): string | null => {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([\x21-\x7E]{8,512})$/u.exec(authorization);
  return match?.[1] ?? null;
};

const principalFor = async (
  request: FastifyRequest,
  authentication: ExpertHttpAuthentication,
): Promise<ExpertPrincipal | null> => {
  const token = bearerToken(request);
  if (token === null) return null;
  try {
    const principal = await authentication.resolvePrincipal(token);
    if (
      principal === null ||
      typeof principal.expertId !== "string" ||
      typeof principal.userId !== "string" ||
      typeof principal.provider !== "string" ||
      typeof principal.externalId !== "string" ||
      principal.expertId.length === 0 ||
      principal.userId.length === 0 ||
      principal.provider.length === 0 ||
      principal.externalId.length === 0
    ) {
      return null;
    }
    return principal;
  } catch {
    return null;
  }
};

const forbidden = (reply: FastifyReply) =>
  reply.code(403).send({ error: "forbidden" });
const unavailable = (reply: FastifyReply) =>
  reply.code(503).send({ error: "expert_command_unavailable" });

const safeQuote = (quote: ResidencyQuote): ResidencyQuote => ({
  tariffVersionId: quote.tariffVersionId,
  displayName: quote.displayName,
  description: quote.description,
  priceMinor: quote.priceMinor,
  currency: quote.currency,
  durationSeconds: quote.durationSeconds,
  creditMinor: quote.creditMinor,
  cashMinor: quote.cashMinor,
});

const validQuote = (quote: ResidencyQuote): boolean =>
  typeof quote.tariffVersionId === "string" &&
  typeof quote.displayName === "string" &&
  quote.displayName.length > 0 &&
  quote.displayName.length <= 256 &&
  typeof quote.description === "string" &&
  quote.description.length > 0 &&
  quote.description.length <= 256 &&
  decimalMinor.test(quote.priceMinor) &&
  quote.currency === "RUB" &&
  Number.isSafeInteger(quote.durationSeconds) &&
  quote.durationSeconds >= 86_400 &&
  quote.durationSeconds <= 315_360_000 &&
  decimalMinor.test(quote.creditMinor) &&
  decimalMinor.test(quote.cashMinor);

const denied = (
  value: unknown,
): value is { readonly kind: "forbidden" | "disabled" } =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  ((value as { kind?: unknown }).kind === "forbidden" ||
    (value as { kind?: unknown }).kind === "disabled");

export const expertReferralRoutes: FastifyPluginAsync<
  ExpertReferralRouteDependencies
> = async (app, deps) => {
  const redeemLimit = deps.redeemLimit ?? 5;
  if (
    !Number.isSafeInteger(redeemLimit) ||
    redeemLimit < 1 ||
    redeemLimit > 100
  ) {
    throw new Error("invalid_expert_redeem_limit");
  }
  app.post(
    "/v1/expert/referrals/redeem",
    {
      schema: {
        body: {
          type: "object",
          propertyNames: { enum: ["code", "idempotencyKey"] },
          required: ["code", "idempotencyKey"],
          properties: {
            code: {
              type: "string",
              minLength: 3,
              maxLength: 256,
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
            },
            idempotencyKey: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: boundedIdentifier,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalFor(request, deps.authentication);
      if (principal === null) return forbidden(reply);
      if (
        !deps.rateLimiter.consume(
          `expert-referral:redeem:${principal.expertId}`,
          redeemLimit,
          60_000,
        )
      ) {
        return reply.code(429).send({ error: "rate_limited" });
      }
      const body = request.body as { code: string; idempotencyKey: string };
      try {
        const result = await deps.referrals.redeemCode(
          principal,
          body.code,
          body.idempotencyKey,
        );
        if (denied(result)) return forbidden(reply);
        return { kind: "redeemed" };
      } catch {
        return unavailable(reply);
      }
    },
  );

  app.get("/v1/expert/referrals/summary", async (request, reply) => {
    const principal = await principalFor(request, deps.authentication);
    if (principal === null) return forbidden(reply);
    try {
      const result = await deps.referrals.summary(principal);
      if (denied(result)) return forbidden(reply);
      if (
        !decimalMinor.test(result.spendableBalanceMinor) ||
        !decimalMinor.test(result.reservedBalanceMinor) ||
        !decimalMinor.test(result.debtMinor) ||
        (result.nearestExpiryAt !== null &&
          (!(result.nearestExpiryAt instanceof Date) ||
            !Number.isFinite(result.nearestExpiryAt.getTime())))
      ) {
        return unavailable(reply);
      }
      return {
        spendableBalanceMinor: result.spendableBalanceMinor,
        reservedBalanceMinor: result.reservedBalanceMinor,
        debtMinor: result.debtMinor,
        nearestExpiryAt: result.nearestExpiryAt?.toISOString() ?? null,
      };
    } catch {
      return unavailable(reply);
    }
  });

  app.post(
    "/v1/expert/residency/quotes",
    {
      schema: {
        body: {
          type: "object",
          propertyNames: { enum: ["tariffVersionId"] },
          required: ["tariffVersionId"],
          properties: {
            tariffVersionId: { type: "string", pattern: uuid },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalFor(request, deps.authentication);
      if (principal === null) return forbidden(reply);
      const { tariffVersionId } = request.body as { tariffVersionId: string };
      try {
        const tariffKey =
          await deps.tariffVersions.tariffKeyFor(tariffVersionId);
        if (tariffKey === null) return forbidden(reply);
        const result = await deps.residency.quote(principal, tariffKey);
        if (
          denied(result) ||
          result.tariffVersionId !== tariffVersionId ||
          !validQuote(result)
        ) {
          return forbidden(reply);
        }
        return safeQuote(result);
      } catch {
        return unavailable(reply);
      }
    },
  );

  app.post(
    "/v1/expert/residency/checkouts",
    {
      schema: {
        body: {
          type: "object",
          propertyNames: { enum: ["tariffVersionId", "idempotencyKey"] },
          required: ["tariffVersionId", "idempotencyKey"],
          properties: {
            tariffVersionId: { type: "string", pattern: uuid },
            idempotencyKey: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: boundedIdentifier,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const principal = await principalFor(request, deps.authentication);
      if (principal === null) return forbidden(reply);
      const body = request.body as {
        tariffVersionId: string;
        idempotencyKey: string;
      };
      try {
        const tariffKey = await deps.tariffVersions.tariffKeyFor(
          body.tariffVersionId,
        );
        if (tariffKey === null) return forbidden(reply);
        const providerDeadline = deps.checkoutDeadline();
        if (
          !(providerDeadline instanceof Date) ||
          !Number.isFinite(providerDeadline.getTime())
        ) {
          return unavailable(reply);
        }
        const result = await deps.residency.checkout(principal, {
          tariffKey,
          idempotencyKey: body.idempotencyKey,
          providerDeadline,
        });
        if (denied(result)) return forbidden(reply);
        if (
          result.order.tariffVersionId !== body.tariffVersionId ||
          result.order.expertId !== principal.expertId
        ) {
          return forbidden(reply);
        }
        return {
          kind: "checkout_created",
          orderId: result.order.orderId,
          outcome:
            result.payment.kind === "created"
              ? {
                  kind: "created",
                  checkoutUrl: result.payment.checkoutUrl,
                  expiresAt: result.payment.expiresAt,
                }
              : { kind: "pending_reconciliation" },
        };
      } catch {
        return unavailable(reply);
      }
    },
  );
};
