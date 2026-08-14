import type { ExpertAiIngressService } from "@ii-tonya/application";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { ExpertPrincipalResolver } from "../expert-principal-resolver.js";

const uuidPattern =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const correlationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "locale"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 4_096 },
    locale: { type: "string", minLength: 1, maxLength: 32 },
    tariffVersionId: { type: "string", pattern: uuidPattern },
  },
} as const;

export interface ExpertAiHttpDependencies {
  readonly principals: ExpertPrincipalResolver;
  readonly ingress: ExpertAiIngressService;
  readonly requests: ExpertAiRequestLedger;
}

export type ExpertAiTransportOutcome = {
  readonly status: 200 | 403 | 422 | 503;
  readonly body: Readonly<Record<string, string>>;
};

export interface ExpertAiRequestLedger {
  claim(input: {
    readonly expertId: string;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
  }): Promise<
    | { readonly kind: "claimed"; readonly claimId: string }
    | { readonly kind: "replay"; readonly outcome: ExpertAiTransportOutcome }
    | { readonly kind: "conflict" }
    | { readonly kind: "busy" }
  >;
  complete(
    claimId: string,
    outcome: ExpertAiTransportOutcome,
  ): Promise<void>;
  fail(claimId: string): Promise<void>;
}

const outcomeFor = (
  result: Awaited<ReturnType<ExpertAiIngressService["handle"]>>,
): ExpertAiTransportOutcome => {
  switch (result.kind) {
    case "completed":
      return {
        status: 200,
        body: { status: "completed", proposalKind: result.proposalKind },
      };
    case "rejected":
      return {
        status: 422,
        body: {
          error: "proposal_rejected",
          reasonCode: result.reasonCode,
        },
      };
    case "forbidden":
      return { status: 403, body: { error: "forbidden" } };
    case "disabled":
      return { status: 503, body: { error: "feature_disabled" } };
    case "unavailable":
      return { status: 503, body: { error: "unavailable" } };
  }
};

const sendOutcome = (reply: FastifyReply, outcome: ExpertAiTransportOutcome) =>
  reply.code(outcome.status).send(outcome.body);

export const expertAiIngressRoutes: FastifyPluginAsync<
  ExpertAiHttpDependencies
> = async (app, deps) => {
  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as {
      readonly validation?: unknown;
      readonly statusCode?: unknown;
    };
    if (candidate.validation !== undefined)
      return reply.code(400).send({ error: "invalid_request" });
    if (candidate.statusCode === 413)
      return reply.code(413).send({ error: "payload_too_large" });
    return reply.code(500).send({ error: "internal_error" });
  });

  app.post(
    "/v1/expert/assistant/messages",
    { bodyLimit: 8 * 1024, schema: { body: bodySchema } },
    async (request, reply) => {
      const idempotency = request.headers["idempotency-key"];
      const requestedCorrelation = request.headers["x-correlation-id"];
      if (
        typeof idempotency !== "string" ||
        !idempotencyPattern.test(idempotency) ||
        (requestedCorrelation !== undefined &&
          (typeof requestedCorrelation !== "string" ||
            !correlationPattern.test(requestedCorrelation)))
      ) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const principal = await deps.principals.resolve(
        request.headers.authorization,
      );
      if (principal?.authenticated !== true)
        return reply.code(401).send({ error: "unauthorized" });
      const body = request.body as {
        readonly text: string;
        readonly locale: string;
        readonly tariffVersionId?: string;
      };
      const digest = createHash("sha256")
        .update(
          JSON.stringify([
            body.text,
            body.locale,
            body.tariffVersionId ?? null,
          ]),
          "utf8",
        )
        .digest("hex");
      const claim = await deps.requests.claim({
        expertId: principal.expertId,
        idempotencyKey: idempotency,
        requestDigest: digest,
      });
      if (claim.kind === "conflict")
        return reply.code(409).send({ error: "idempotency_conflict" });
      if (claim.kind === "busy")
        return reply.code(409).send({ error: "request_in_progress" });
      if (claim.kind === "replay") return sendOutcome(reply, claim.outcome);
      try {
        const result = await deps.ingress.handle({
          principal,
          text: body.text,
          locale: body.locale,
          idempotencyKey: idempotency,
          correlationId: requestedCorrelation ?? crypto.randomUUID(),
          ...(body.tariffVersionId === undefined
            ? {}
            : { tariffVersionId: body.tariffVersionId }),
        });
        const outcome = outcomeFor(result);
        if (result.kind === "unavailable")
          await deps.requests.fail(claim.claimId);
        else await deps.requests.complete(claim.claimId, outcome);
        return sendOutcome(reply, outcome);
      } catch (error) {
        await deps.requests.fail(claim.claimId);
        throw error;
      }
    },
  );
};
import { createHash } from "node:crypto";
