import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ExpertSessionService } from "@ii-tonya/application";
import type {
  ExpertSessionLookup,
  ExpertPrincipalResolver,
} from "../expert-principal-resolver.js";
import {
  parseExpertBearer,
  expertSessionTokenHash,
} from "../expert-session-token.js";
import { parseClientSessionBody } from "../client-session-body.js";
import { readExactAuthorization } from "../authorization-header.js";
import { createWindowedRateLimiter } from "../rate-limit.js";
export interface ExpertSessionRoutesOptions {
  sessions?: ExpertSessionService & {
    revoke(hash: string): Promise<{ kind: "revoked" } | { kind: "denied" }>;
  };
  lookup?: ExpertSessionLookup;
  principals?: ExpertPrincipalResolver;
}
export const headerCount = (r: FastifyRequest, name: string) =>
  r.raw.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name)
    .length;
export function expertProofBody(r: FastifyRequest) {
  if (
    [
      "content-type",
      "content-length",
      "content-encoding",
      "transfer-encoding",
    ].some((h) => headerCount(r, h) > 1) ||
    r.headers["content-encoding"] !== undefined ||
    r.headers["transfer-encoding"] !== undefined ||
    !Buffer.isBuffer(r.body) ||
    (r.headers["content-length"] !== undefined &&
      r.headers["content-length"] !== String(r.body.length))
  )
    return null;
  return parseClientSessionBody({
    body: r.body,
    contentType: r.headers["content-type"],
  });
}
export async function issueExpertBounded(
  sessions: ExpertSessionService,
  proof: string,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sessions.issue(proof, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("expert_session_timeout"));
        }, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export const expertSessionRoutes: FastifyPluginAsync<
  ExpertSessionRoutesOptions
> = async (app, deps) => {
  const limiter = createWindowedRateLimiter();
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_r, b, done) =>
    done(null, b),
  );
  app.addHook("onRequest", async (r, reply) => {
    reply.header("cache-control", "no-store").header("pragma", "no-cache");
    if (r.url.includes("?") || headerCount(r, "authorization") > 1)
      return reply.code(400).send({ error: "invalid_request" });
    if (
      !limiter.consume("global", 60, 60000) ||
      !limiter.consume(r.ip, 10, 60000)
    )
      return reply.code(429).send({ error: "rate_limited" });
  });
  app.setErrorHandler((error, _r, reply) =>
    reply
      .code(
        (error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? 400
          : 503,
      )
      .send({ error: "session_unavailable" }),
  );
  app.post("/v1/expert/sessions", { bodyLimit: 8192 }, async (r, reply) => {
    if (r.headers.authorization !== undefined)
      return reply.code(400).send({ error: "invalid_request" });
    const body = expertProofBody(r);
    if (!body) return reply.code(400).send({ error: "invalid_request" });
    if (!deps.sessions)
      return reply.code(503).send({ error: "session_unavailable" });
    const result = await issueExpertBounded(deps.sessions, body.identityProof);
    if (result.kind !== "issued")
      return reply
        .code(result.kind === "unauthorized" ? 401 : 503)
        .send({ error: "session_unavailable" });
    return reply.code(201).send({
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      expiresAt: result.expiresAt,
    });
  });
  app.get("/v1/expert/session", async (r, reply) => {
    const token = parseExpertBearer(readExactAuthorization(r.raw.rawHeaders));
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    if (!deps.lookup)
      return reply.code(503).send({ error: "session_unavailable" });
    const result = await deps.lookup.findByTokenHash(
      expertSessionTokenHash(token),
    );
    if (!result) return reply.code(401).send({ error: "unauthorized" });
    return {
      userId: result.userId,
      expertId: result.expertId,
      expiresAt: result.expiresAt.toISOString(),
    };
  });
  app.delete("/v1/expert/sessions/current", async (r, reply) => {
    const token = parseExpertBearer(readExactAuthorization(r.raw.rawHeaders));
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    if (!deps.sessions)
      return reply.code(503).send({ error: "session_unavailable" });
    const result = await deps.sessions.revoke(expertSessionTokenHash(token));
    return result.kind === "revoked"
      ? reply.code(204).send()
      : reply.code(401).send({ error: "unauthorized" });
  });
};
