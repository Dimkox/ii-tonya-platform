import type {
  ClientPrincipalResolver,
  ClientSessionService,
} from "@ii-tonya/application";
import type { FastifyPluginAsync } from "fastify";

import { readExactAuthorization } from "../authorization-header.js";
import { resolveClientPrincipal } from "../client-principal-resolver.js";
import { parseClientSessionBody } from "../client-session-body.js";
import {
  clientSessionTokenHash,
  parseClientBearer,
} from "../client-session-token.js";

interface RouteOptions {
  readonly sessions: Pick<ClientSessionService, "issue"> & {
    revoke(
      tokenDigest: `sha256:${string}`,
    ): Promise<{ readonly kind: "revoked" } | { readonly kind: "denied" }>;
  };
  readonly principals: ClientPrincipalResolver;
  readonly metrics?: {
    record(labels: {
      operation: "issue" | "revoke";
      outcome: "allowed" | "denied" | "unavailable";
    }): void;
  };
}

interface RawHeader {
  readonly valid: boolean;
  readonly value?: string;
}

const readRawHeader = (
  rawHeaders: readonly string[],
  name: string,
): RawHeader => {
  if (rawHeaders.length % 2 !== 0) return { valid: false };
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) {
      const value = rawHeaders[index + 1];
      if (value === undefined) return { valid: false };
      values.push(value);
    }
  }
  if (values.length > 1) return { valid: false };
  return values.length === 0
    ? { valid: true }
    : { valid: true, value: values[0]! };
};

export const clientSessionRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  deps,
) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.setErrorHandler((error, _request, reply) => {
    const code = (error as { code?: string }).code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  app.post<{ Body: Buffer }>(
    "/v1/client/sessions",
    { bodyLimit: 8 * 1024 },
    async (request, reply) => {
      const controller = new AbortController();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      function cleanup() {
        if (deadline !== undefined) clearTimeout(deadline);
        request.raw.removeListener("aborted", abort);
        reply.raw.removeListener("close", abortOnClosedResponse);
        reply.raw.removeListener("finish", cleanup);
      }
      function abort() {
        controller.abort();
        cleanup();
      }
      function abortOnClosedResponse() {
        if (!reply.raw.writableEnded) abort();
        else cleanup();
      }
      request.raw.once("aborted", abort);
      reply.raw.once("close", abortOnClosedResponse);
      reply.raw.once("finish", cleanup);
      deadline = setTimeout(abort, 3_000);
      deadline.unref?.();
      reply.header("cache-control", "no-store").header("pragma", "no-cache");
      const contentType = readRawHeader(request.raw.rawHeaders, "content-type");
      const contentEncoding = readRawHeader(
        request.raw.rawHeaders,
        "content-encoding",
      );
      const contentLength = readRawHeader(
        request.raw.rawHeaders,
        "content-length",
      );
      const transferEncoding = readRawHeader(
        request.raw.rawHeaders,
        "transfer-encoding",
      );
      if (
        !contentType.valid ||
        !contentEncoding.valid ||
        !contentLength.valid ||
        !transferEncoding.valid
      ) {
        deps.metrics?.record({ operation: "issue", outcome: "denied" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const parsed = parseClientSessionBody({
        body: request.body,
        contentType: contentType.value,
        ...(contentEncoding.value === undefined
          ? {}
          : { contentEncoding: contentEncoding.value }),
        ...(contentLength.value === undefined
          ? {}
          : { contentLength: contentLength.value }),
        ...(transferEncoding.value === undefined
          ? {}
          : { transferEncoding: transferEncoding.value }),
      });
      if (parsed === null) {
        deps.metrics?.record({ operation: "issue", outcome: "denied" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const result = await deps.sessions.issue(
        parsed.identityProof,
        controller.signal,
      );
      if (result.kind === "unauthorized") {
        deps.metrics?.record({ operation: "issue", outcome: "denied" });
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (result.kind === "unavailable") {
        deps.metrics?.record({ operation: "issue", outcome: "unavailable" });
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
      deps.metrics?.record({ operation: "issue", outcome: "allowed" });
      return reply.code(201).send({
        accessToken: result.accessToken,
        tokenType: result.tokenType,
        scope: result.scope,
        expiresAt: result.expiresAt,
      });
    },
  );

  app.delete("/v1/client/sessions/current", async (request, reply) => {
    const authorization = readExactAuthorization(request.raw.rawHeaders);
    if (authorization === null) {
      deps.metrics?.record({ operation: "revoke", outcome: "denied" });
      return reply.code(401).send({ error: "unauthorized" });
    }
    const resolution = await resolveClientPrincipal(
      deps.principals,
      authorization,
    );
    if (resolution.kind === "denied") {
      deps.metrics?.record({ operation: "revoke", outcome: "denied" });
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (resolution.kind === "unavailable") {
      deps.metrics?.record({ operation: "revoke", outcome: "unavailable" });
      return reply.code(503).send({ error: "temporarily_unavailable" });
    }
    const token = parseClientBearer(authorization);
    if (token === null) {
      deps.metrics?.record({ operation: "revoke", outcome: "denied" });
      return reply.code(401).send({ error: "unauthorized" });
    }
    try {
      const result = await deps.sessions.revoke(clientSessionTokenHash(token));
      deps.metrics?.record({
        operation: "revoke",
        outcome: result.kind === "revoked" ? "allowed" : "denied",
      });
      return result.kind === "revoked"
        ? reply.code(204).send()
        : reply.code(401).send({ error: "unauthorized" });
    } catch {
      deps.metrics?.record({ operation: "revoke", outcome: "unavailable" });
      return reply.code(503).send({ error: "temporarily_unavailable" });
    }
  });
};
