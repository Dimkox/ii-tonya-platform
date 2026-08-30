import type { FastifyPluginAsync } from "fastify";
type TrialHandler = {
  handle(input: {
    kind: "residual";
    redemptionId: string;
    requestKey: string;
    requestDigest: string;
    text: string;
  }): Promise<unknown>;
};
export interface TestExpertPromoDependencies {
  enabled: boolean;
  deterministicEnabled: boolean;
  selartiEnabled: boolean;
  promptVersion?: string;
  campaignAvailable: boolean;
  trial: TrialHandler;
  identity: (telegramUserId: string) => Promise<{ userId: string } | null>;
}
const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["telegramUserId", "text", "requestKey", "requestDigest"],
  properties: {
    telegramUserId: { type: "string", minLength: 1, maxLength: 64 },
    text: { type: "string", minLength: 1, maxLength: 4096 },
    requestKey: { type: "string", minLength: 8, maxLength: 128 },
    requestDigest: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
} as const;
export const testExpertPromoRoutes: FastifyPluginAsync<
  TestExpertPromoDependencies
> = async (app, deps) => {
  app.post(
    "/v1/test-expert-promo/message",
    { schema: { body: bodySchema } },
    async (request, reply) => {
      if (!deps.enabled) return reply.code(503).send({ status: "disabled" });
      if (
        !deps.deterministicEnabled ||
        !deps.campaignAvailable ||
        !deps.promptVersion ||
        !deps.selartiEnabled
      )
        return reply.code(503).send({ status: "unavailable" });
      const body = request.body as {
        telegramUserId: string;
        text: string;
        requestKey: string;
        requestDigest: string;
      };
      const principal = await deps.identity(body.telegramUserId);
      if (!principal)
        return reply.code(403).send({ status: "invalid_request" });
      try {
        const result = await deps.trial.handle({
          kind: "residual",
          redemptionId: principal.userId,
          requestKey: body.requestKey,
          requestDigest: body.requestDigest,
          text: body.text,
        });
        return reply.send({ status: "success", result });
      } catch (error) {
        if (error instanceof Error && error.message === "trial_cap_reached")
          return reply.code(429).send({ status: "limit_reached" });
        if (error instanceof Error && error.message.includes("invalid_request"))
          return reply.code(400).send({ status: "invalid_request" });
        return reply.code(503).send({ status: "unavailable" });
      }
    },
  );
};
