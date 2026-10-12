import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  parseExpertBearer,
  expertSessionTokenHash,
} from "../expert-session-token.js";
import {
  expertProofBody,
  headerCount,
  issueExpertBounded,
  type ExpertSessionRoutesOptions,
} from "./expert-sessions.js";
import { createWindowedRateLimiter } from "../rate-limit.js";
export interface ExpertBrowserOptions extends ExpertSessionRoutesOptions {
  origin?: string;
  botUsername?: string;
  widgetEnabled?: boolean;
}
const SESSION = "__Host-expert-session",
  CSRF = "__Host-expert-csrf";
const cookie = (name: string, value: string, age: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
function cookies(r: FastifyRequest) {
  if (headerCount(r, "cookie") > 1) return null;
  const result = new Map<string, string>();
  for (const part of (r.headers.cookie ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== SESSION && name !== CSRF) continue;
    if (result.has(name)) return null;
    result.set(name, rest.join("="));
  }
  return result;
}
export const expertBrowserSessionRoutes: FastifyPluginAsync<
  ExpertBrowserOptions
> = async (app, deps) => {
  const secret = randomBytes(32),
    limiter = createWindowedRateLimiter();
  const available = !!(
    deps.sessions &&
    deps.lookup &&
    deps.origin &&
    deps.botUsername
  );
  const csrf = (nonce: string, token: string) =>
    createHmac("sha256", secret)
      .update(`expert-session:${nonce}:${token}`)
      .digest("hex");
  const token = (r: FastifyRequest) =>
    parseExpertBearer(`Bearer ${cookies(r)?.get(SESSION) ?? ""}`);
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_r, b, done) =>
    done(null, b),
  );
  app.setErrorHandler((error, _r, reply) =>
    reply
      .code(
        (error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE"
          ? 400
          : 503,
      )
      .send({ error: "session_unavailable" }),
  );
  app.addHook("onRequest", async (r, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("pragma", "no-cache")
      .header("referrer-policy", "no-referrer");
    if (
      r.url.includes("?") ||
      cookies(r) === null ||
      headerCount(r, "authorization") > 0 ||
      headerCount(r, "origin") > 1 ||
      headerCount(r, "x-csrf-token") > 1 ||
      headerCount(r, "sec-fetch-site") > 1
    )
      return reply.code(400).send({ error: "invalid_request" });
    if (
      !limiter.consume("global", 120, 60000) ||
      !limiter.consume(r.ip, 30, 60000)
    )
      return reply.code(429).send({ error: "rate_limited" });
    if (
      r.headers["sec-fetch-site"] === "cross-site" ||
      (r.headers.origin !== undefined && r.headers.origin !== deps.origin)
    )
      return reply.code(403).send({ error: "forbidden" });
    if (r.method !== "GET" && r.method !== "HEAD") {
      const nonce = cookies(r)?.get(CSRF) ?? "",
        supplied = r.headers["x-csrf-token"];
      if (
        !available ||
        headerCount(r, "origin") !== 1 ||
        r.headers.origin !== deps.origin ||
        typeof supplied !== "string" ||
        supplied.length !== 64 ||
        !/^[a-f0-9]{64}$/u.test(supplied) ||
        nonce.length !== 43 ||
        !/^[A-Za-z0-9_-]{43}$/u.test(nonce) ||
        !timingSafeEqual(
          Buffer.from(supplied),
          Buffer.from(csrf(nonce, token(r) ?? "")),
        )
      )
        return reply.code(403).send({ error: "forbidden" });
    }
  });
  app.get("/v1/expert/browser/session", async (r, reply) => {
    if (!available) return { available: false, authenticated: false };
    const bearer = token(r),
      resolved = bearer
        ? await deps.lookup!.findByTokenHash(expertSessionTokenHash(bearer))
        : null;
    let nonce = cookies(r)?.get(CSRF);
    const set: string[] = [];
    if (!nonce || nonce.length !== 43 || !/^[A-Za-z0-9_-]{43}$/u.test(nonce)) {
      nonce = randomBytes(32).toString("base64url");
      set.push(cookie(CSRF, nonce, 3600));
    }
    if (!resolved && cookies(r)?.has(SESSION)) set.push(cookie(SESSION, "", 0));
    if (set.length) reply.header("set-cookie", set);
    return {
      available: true,
      authenticated: !!resolved,
      csrfToken: csrf(nonce, resolved ? bearer! : ""),
      botUsername: deps.botUsername,
      widgetEnabled: deps.widgetEnabled === true,
      ...(resolved
        ? {
            userId: resolved.userId,
            expertId: resolved.expertId,
            expiresAt: resolved.expiresAt.toISOString(),
          }
        : {}),
    };
  });
  app.post(
    "/v1/expert/browser/session",
    { bodyLimit: 8192 },
    async (r, reply) => {
      const body = expertProofBody(r);
      if (!body) return reply.code(400).send({ error: "invalid_request" });
      if (cookies(r)?.has(SESSION))
        return reply.code(409).send({ error: "logout_required" });
      const result = await issueExpertBounded(
        deps.sessions!,
        body.identityProof,
      );
      if (result.kind !== "issued")
        return reply
          .code(result.kind === "unauthorized" ? 401 : 503)
          .send({ error: "session_unavailable" });
      const nonce = randomBytes(32).toString("base64url");
      reply.header("set-cookie", [
        cookie(
          SESSION,
          result.accessToken,
          Math.max(
            0,
            Math.min(
              3600,
              Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000),
            ),
          ),
        ),
        cookie(CSRF, nonce, 3600),
      ]);
      return reply.code(201).send({
        authenticated: true,
        expiresAt: result.expiresAt,
        csrfToken: csrf(nonce, result.accessToken),
      });
    },
  );
  app.delete("/v1/expert/browser/session", async (r, reply) => {
    const bearer = token(r);
    if (bearer) await deps.sessions!.revoke(expertSessionTokenHash(bearer));
    reply.header("set-cookie", [cookie(SESSION, "", 0), cookie(CSRF, "", 0)]);
    return reply.code(204).send();
  });
};
