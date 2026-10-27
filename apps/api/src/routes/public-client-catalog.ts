import type { FastifyPluginAsync } from "fastify";
import { METHODS } from "node:http";
import {
  createWindowedRateLimiter,
  type RateLimitGate,
} from "../rate-limit.js";

export interface PublicCatalogRead {
  listPublicServices(input: { limit: number }): Promise<unknown>;
}
export interface PublicCatalogLoadState {
  readonly limiter: RateLimitGate;
  inFlight: number;
}
// Shared by every production app instance in this process, never keyed by caller.
const processLoad: PublicCatalogLoadState = {
  limiter: createWindowedRateLimiter({ maxKeys: 1 }),
  inFlight: 0,
};

const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.replace(
    /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cf}\p{M}\u2800]/gu,
    "",
  ).length > 0 &&
  value.length <= max &&
  !/[\p{Cc}\p{Bidi_Control}]/u.test(value);

export const publicClientCatalogRoutes: FastifyPluginAsync<{
  catalog?: PublicCatalogRead;
  loadState?: PublicCatalogLoadState;
}> = async (app, { catalog, loadState = processLoad }) => {
  // Fastify's default method set omits DAV methods understood by Node. Register
  // them here so unsupported verbs cannot reach an echoing default 404.
  for (const method of METHODS) {
    if (!app.supportedMethods.includes(method)) app.addHttpMethod(method);
  }
  app.all("/v1/public/catalog", {
    onSend: async (request, _reply, payload) =>
      request.method === "HEAD" ? null : payload,
    onRequest: async (request, reply) => {
      reply.header("cache-control", "no-store");
      reply.header("referrer-policy", "no-referrer");
      if (request.method !== "GET" && request.method !== "HEAD") {
        return reply
          .header("allow", "GET, HEAD")
          .code(405)
          .send({ error: "method_not_allowed" });
      }
      // Reject before body parsing or repository access; never consume private input.
      if (
        request.raw.url?.includes("?") ||
        request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      ) {
        return reply.code(400).send({ error: "invalid_request" });
      }
    },
    handler: async (_request, reply) => {
      const failure = (
        reason:
          | "rate_limited"
          | "busy"
          | "missing_repository"
          | "deadline"
          | "repository_failure"
          | "invalid_output",
      ) => {
        app.log.warn({ reason }, "public_catalog_failure");
        return reply.code(reason === "rate_limited" ? 429 : 503).send({
          error:
            reason === "rate_limited" ? "rate_limited" : "catalog_unavailable",
        });
      };
      if (!loadState.limiter.consume("public_catalog", 60, 60_000))
        return failure("rate_limited");
      if (!catalog) return failure("missing_repository");
      if (loadState.inFlight >= 2) return failure("busy");
      loadState.inFlight++;
      const operation = Promise.resolve()
        .then(() => catalog.listPublicServices({ limit: 20 }))
        .then(
          (rows) => {
            loadState.inFlight--;
            return { kind: "rows" as const, rows };
          },
          () => {
            loadState.inFlight--;
            return { kind: "repository_failure" as const };
          },
        );
      // A timeout is not DB cancellation. Only operation settlement releases a
      // slot, including when acquiring a connection is still waiting internally.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<{ kind: "deadline" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "deadline" }), 3_000);
      });
      let outcome: Awaited<typeof operation> | { kind: "deadline" };
      try {
        outcome = await Promise.race([operation, deadline]);
      } finally {
        clearTimeout(timer);
      }
      if (outcome.kind !== "rows") return failure(outcome.kind);
      try {
        const rows = outcome.rows;
        if (!Array.isArray(rows) || rows.length > 20)
          throw new Error("invalid_catalog");
        const items: {
          displayName: string;
          serviceCode: string;
          serviceTitle?: string;
          language: string;
        }[] = [];
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row))
            throw new Error("invalid_catalog");
          const { displayName, serviceCode, serviceTitle, language } =
            row as Record<string, unknown>;
          if (
            !validText(displayName, 200) ||
            !validText(serviceCode, 64) ||
            (serviceTitle !== undefined && !validText(serviceTitle, 160)) ||
            !validText(language, 32)
          )
            throw new Error("invalid_catalog");
          items.push({
            displayName,
            serviceCode,
            language,
            ...(typeof serviceTitle === "string" ? { serviceTitle } : {}),
          });
        }
        return { items };
      } catch {
        return failure("invalid_output");
      }
    },
  });
};
