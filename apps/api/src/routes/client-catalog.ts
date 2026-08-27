import type {
  ClientCatalogService,
  ClientPrincipalResolver,
} from "@ii-tonya/application";
import type { FastifyPluginAsync } from "fastify";

import { readExactAuthorization } from "../authorization-header.js";
import { resolveClientPrincipal } from "../client-principal-resolver.js";

interface RouteOptions {
  readonly principals: ClientPrincipalResolver;
  readonly catalog: ClientCatalogService;
}

const uuidPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const uuidRegex = new RegExp(uuidPattern, "u");
const controlPattern = /[\u0000-\u001f\u007f]/u;

const strictFilters = (
  value: unknown,
): { serviceCode?: string; language?: string } | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "serviceCode" && key !== "language",
    )
  ) {
    return null;
  }
  for (const [key, maximum] of [
    ["serviceCode", 64],
    ["language", 32],
  ] as const) {
    const candidate = record[key];
    if (
      candidate !== undefined &&
      (typeof candidate !== "string" ||
        candidate.trim().length < 1 ||
        candidate.trim().length > maximum ||
        controlPattern.test(candidate))
    ) {
      return null;
    }
  }
  return record as { serviceCode?: string; language?: string };
};

export const clientCatalogRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  deps,
) => {
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: string }).code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(413).send({ error: "payload_too_large" });
    }
    if ((error as { validation?: unknown }).validation !== undefined) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  app.post<{ Body: { serviceCode?: string; language?: string } }>(
    "/v1/client/catalog-requests",
    { bodyLimit: 8 * 1024 },
    async (request, reply) => {
      const authorization = readExactAuthorization(request.raw.rawHeaders);
      if (authorization === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const resolution = await resolveClientPrincipal(
        deps.principals,
        authorization,
      );
      if (resolution.kind === "denied") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (resolution.kind === "unavailable") {
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
      const filters = strictFilters(request.body);
      if (filters === null) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      try {
        const receipt = await deps.catalog.request(resolution.principal, filters);
        return reply.code(202).send({
          catalogRequestId: receipt.catalogRequestId,
          state: receipt.state,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "client_catalog_filters_invalid"
        ) {
          return reply.code(400).send({ error: "invalid_request" });
        }
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.get<{ Params: { catalogRequestId: string } }>(
    "/v1/client/catalog-requests/:catalogRequestId",
    async (request, reply) => {
      const authorization = readExactAuthorization(request.raw.rawHeaders);
      if (authorization === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const resolution = await resolveClientPrincipal(
        deps.principals,
        authorization,
      );
      if (resolution.kind === "denied") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (resolution.kind === "unavailable") {
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
      if (!uuidRegex.test(request.params.catalogRequestId)) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      try {
        const snapshot = await deps.catalog.get(
          resolution.principal,
          request.params.catalogRequestId,
        );
        if (snapshot === null) {
          return reply.code(404).send({ error: "not_found" });
        }
        return reply.code(200).send(snapshot);
      } catch {
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
