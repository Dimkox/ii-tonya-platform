import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  parseClientAccountPackages,
  type ClientAccountPackagesRepository,
} from "../../../../packages/contracts/src/client-account-packages.js";
import type {
  ClientPrincipalResolver,
  ClientSessionService,
  ErasureRequestService,
} from "@ii-tonya/application";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  clientSessionTokenHash,
  parseClientBearer,
} from "../client-session-token.js";
import { resolveClientPrincipal } from "../client-principal-resolver.js";
import { parseClientSessionBody } from "../client-session-body.js";
import { createWindowedRateLimiter } from "../rate-limit.js";
export interface BrowserAccountOptions {
  clientAccountPackages?: ClientAccountPackagesRepository;
  origin?: string;
  botUsername?: string;
  widgetEnabled: boolean;
  privacyEnabled: boolean;
  erasureRequestsEnabled?: boolean;
  erasureRequests?: ErasureRequestService;
  sessions?: Pick<ClientSessionService, "issue"> & {
    revoke(
      digest: `sha256:${string}`,
    ): Promise<{ kind: "revoked" } | { kind: "denied" }>;
  };
  principals?: ClientPrincipalResolver;
  bookingPrincipals?: ClientPrincipalResolver;
  bookingEnabled?: boolean;
  bookingReserveEnabled?: boolean;
  catalogEnabled?: boolean;
}
const SESSION = "__Host-client-session";
const NONCE = "__Host-client-csrf";
function cookieValues(request: FastifyRequest): Map<string, string> | null {
  const values = new Map<string, string>();
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    if (key !== SESSION && key !== NONCE) continue;
    if (values.has(key)) return null;
    values.set(key, pair.slice(index + 1).trim());
  }
  return values;
}
const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const browserAccountRoutes: FastifyPluginAsync<
  BrowserAccountOptions
> = async (app, deps) => {
  const secret = randomBytes(32);
  const limiter = createWindowedRateLimiter();
  const available = !!(
    deps.origin &&
    deps.botUsername &&
    deps.sessions &&
    deps.principals
  );
  const csrf = (nonce: string, token: string) =>
    createHmac("sha256", secret).update(`${nonce}:${token}`).digest("hex");
  const sessionToken = (request: FastifyRequest) =>
    parseClientBearer(`Bearer ${cookieValues(request)?.get(SESSION) ?? ""}`);
  const headerCount = (request: FastifyRequest, name: string) =>
    request.raw.rawHeaders.filter(
      (_, i) =>
        i % 2 === 0 && request.raw.rawHeaders[i]?.toLowerCase() === name,
    ).length;
  const matchesSessionBinding = (request: FastifyRequest, token: string) => {
    const nonce = cookieValues(request)?.get(NONCE) ?? "";
    const header = request.headers["x-csrf-token"];
    return (
      headerCount(request, "x-csrf-token") === 1 &&
      typeof header === "string" &&
      /^[0-9a-f]{64}$/u.test(header) &&
      /^[A-Za-z0-9_-]{43}$/u.test(nonce) &&
      equal(header, csrf(nonce, token))
    );
  };
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );
  app.setErrorHandler((error, _request, reply) => {
    if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(400).send({ error: "invalid_request" });
    return reply.code(503).send({ error: "temporarily_unavailable" });
  });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("pragma", "no-cache")
      .header("referrer-policy", "no-referrer");
    if (
      (request.url.includes("?") &&
        !(
          request.method === "GET" &&
          /^\/v1\/browser\/bookings\?after=bk1\.[A-Za-z0-9_-]{43}$/u.test(
            request.url,
          )
        )) ||
      cookieValues(request) === null ||
      request.headers.authorization !== undefined
    )
      return reply.code(400).send({ error: "invalid_request" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      // The status credential has no mutation/account authority and must survive
      // session revocation. Only this exact POST skips session-bound CSRF.
      if (
        request.method === "POST" &&
        request.raw.url === "/v1/browser/privacy/erasure-status"
      ) {
        if (
          !deps.origin ||
          headerCount(request, "origin") !== 1 ||
          request.headers.origin !== deps.origin ||
          request.headers["sec-fetch-site"] === "cross-site"
        )
          return reply.code(403).send({ error: "forbidden" });
        return;
      }
      if (
        !available ||
        headerCount(request, "origin") !== 1 ||
        request.headers.origin !== deps.origin ||
        !matchesSessionBinding(request, sessionToken(request) ?? "")
      )
        return reply.code(403).send({ error: "forbidden" });
    } else if (
      (request.headers.origin !== undefined &&
        request.headers.origin !== deps.origin) ||
      request.headers["sec-fetch-site"] === "cross-site"
    )
      return reply.code(403).send({ error: "forbidden" });
  });
  async function authenticated(request: FastifyRequest, reply: FastifyReply) {
    const token = sessionToken(request);
    if (!available || !token || !deps.principals) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const result = await resolveClientPrincipal(
      deps.principals,
      `Bearer ${token}`,
    );
    if (result.kind !== "resolved") {
      reply
        .code(result.kind === "unavailable" ? 503 : 401)
        .send({ error: "session_unavailable" });
      return null;
    }
    return token;
  }
  app.get("/v1/browser/packages", async (request, reply) => {
    const token = sessionToken(request);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    if (!available || !deps.principals)
      return reply.code(503).send({ error: "temporarily_unavailable" });
    const resolved = await resolveClientPrincipal(
      deps.principals,
      `Bearer ${token}`,
    );
    if (resolved.kind !== "resolved")
      return reply
        .code(resolved.kind === "unavailable" ? 503 : 401)
        .send({ error: "session_unavailable" });
    if (!matchesSessionBinding(request, token))
      return reply.code(403).send({ error: "forbidden" });
    if (!deps.clientAccountPackages)
      return reply.code(503).send({ error: "temporarily_unavailable" });
    try {
      return parseClientAccountPackages(
        await deps.clientAccountPackages.read(resolved.principal.userId),
      );
    } catch {
      return reply.code(503).send({ error: "temporarily_unavailable" });
    }
  });
  app.get("/v1/browser/session", async (request, reply) => {
    if (!available)
      return {
        available: false,
        authenticated: false,
        erasureAvailable: false,
      };
    const setCookies: string[] = [];
    let nonce = cookieValues(request)?.get(NONCE);
    if (!nonce || !/^[A-Za-z0-9_-]{43}$/u.test(nonce)) {
      nonce = randomBytes(32).toString("base64url");
      setCookies.push(cookie(NONCE, nonce, 3600));
    }
    const token = sessionToken(request);
    const resolved =
      token && deps.principals
        ? await resolveClientPrincipal(deps.principals, `Bearer ${token}`)
        : { kind: "denied" };
    if (resolved.kind === "unavailable")
      return reply.code(503).send({ error: "session_unavailable" });
    if (resolved.kind !== "resolved" && cookieValues(request)?.has(SESSION))
      setCookies.push(cookie(SESSION, "", 0));
    if (setCookies.length) reply.header("set-cookie", setCookies);
    const booking =
      resolved.kind === "resolved" &&
      deps.bookingEnabled === true &&
      deps.bookingPrincipals
        ? await resolveClientPrincipal(
            deps.bookingPrincipals,
            `Bearer ${token}`,
          )
        : { kind: "denied" };
    if (booking.kind === "unavailable")
      return reply.code(503).send({ error: "session_unavailable" });
    return {
      available: true,
      authenticated: resolved.kind === "resolved",
      csrfToken: csrf(nonce, resolved.kind === "resolved" ? token! : ""),
      botUsername: deps.botUsername,
      widgetEnabled: deps.widgetEnabled,
      privacyAvailable: deps.privacyEnabled,
      erasureAvailable:
        deps.privacyEnabled &&
        deps.erasureRequestsEnabled === true &&
        !!deps.erasureRequests,
      bookingAvailable: booking.kind === "resolved",
      bookingReserveAvailable:
        booking.kind === "resolved" && deps.bookingReserveEnabled === true,
    };
  });
  app.post(
    "/v1/browser/session",
    { bodyLimit: 8192 },
    async (request, reply) => {
      if (
        !limiter.consume("global", 60, 60000) ||
        !limiter.consume(request.ip, 10, 60000)
      )
        return reply.code(429).send({ error: "rate_limited" });
      const parsed = parseClientSessionBody({
        body: request.body as Buffer,
        contentType: request.headers["content-type"],
        ...(request.headers["content-encoding"] === undefined
          ? {}
          : { contentEncoding: request.headers["content-encoding"] }),
      });
      if (!parsed) return reply.code(400).send({ error: "invalid_request" });
      // No implicit rotation: logout must complete before another proof is used.
      if (cookieValues(request)?.has(SESSION))
        return reply.code(409).send({ error: "logout_required" });
      const result = await deps.sessions!.issue(
        parsed.identityProof,
        AbortSignal.timeout(3000),
      );
      if (result.kind !== "issued")
        return reply
          .code(result.kind === "unauthorized" ? 401 : 503)
          .send({ error: "login_unavailable" });
      const nonce = randomBytes(32).toString("base64url");
      const maxAge = Math.max(
        0,
        Math.min(
          3600,
          Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000),
        ),
      );
      reply.header("set-cookie", [
        cookie(SESSION, result.accessToken, maxAge),
        cookie(NONCE, nonce, 3600),
      ]);
      return reply.code(201).send({
        authenticated: true,
        expiresAt: result.expiresAt,
        csrfToken: csrf(nonce, result.accessToken),
      });
    },
  );
  app.delete("/v1/browser/session", async (request, reply) => {
    const token = sessionToken(request);
    if (token) {
      try {
        await deps.sessions!.revoke(clientSessionTokenHash(token));
      } catch {
        return reply.code(503).send({ error: "logout_unavailable" });
      }
    }
    reply.header("set-cookie", [cookie(SESSION, "", 0), cookie(NONCE, "", 0)]);
    return reply.code(204).send();
  });
  for (const [method, suffix] of [
    ["POST", "erasure-requests"],
    ["GET", "erasure-requests"],
    ["POST", "erasure-status"],
  ] as const) {
    app.route({
      method,
      url: `/v1/browser/privacy/${suffix}`,
      bodyLimit: 1024,
      logLevel: "silent",
      async handler(request, reply) {
        if (request.raw.url !== `/v1/browser/privacy/${suffix}`)
          return reply.code(400).send({ error: "invalid_request" });
        if (
          !limiter.consume(`erasure:${request.ip}`, 30, 60000) ||
          !limiter.consume("erasure:global", 300, 60000)
        )
          return reply.code(429).send({ error: "rate_limited" });
        let userId: string | undefined;
        if (suffix !== "erasure-status") {
          const token = await authenticated(request, reply);
          if (!token) return;
          if (!matchesSessionBinding(request, token))
            return reply.code(403).send({ error: "forbidden" });
          const principal = await resolveClientPrincipal(
            deps.principals!,
            `Bearer ${token}`,
          );
          if (principal.kind !== "resolved")
            return reply
              .code(principal.kind === "unavailable" ? 503 : 401)
              .send({ error: "session_unavailable" });
          userId = principal.principal.userId;
        }
        let receiptToken = "";
        if (
          [
            "content-type",
            "content-length",
            "content-encoding",
            "transfer-encoding",
          ].some((name) => headerCount(request, name) > 1) ||
          request.headers["content-encoding"] !== undefined ||
          request.headers["transfer-encoding"] !== undefined
        )
          return reply.code(400).send({ error: "invalid_request" });
        if (method === "POST") {
          if (
            !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
              request.headers["content-type"] ?? "",
            ) ||
            !Buffer.isBuffer(request.body) ||
            (request.headers["content-length"] !== undefined &&
              request.headers["content-length"] !== String(request.body.length))
          )
            return reply.code(400).send({ error: "invalid_request" });
          try {
            const body: unknown = JSON.parse(request.body.toString("utf8"));
            if (typeof body !== "object" || !body || Array.isArray(body))
              throw new Error();
            const value = body as Record<string, unknown>;
            const keys =
              suffix === "erasure-status"
                ? ["receiptToken"]
                : ["receiptToken", "confirmed"];
            if (
              Object.keys(value).length !== keys.length ||
              Object.keys(value).some((key) => !keys.includes(key)) ||
              typeof value.receiptToken !== "string" ||
              (suffix !== "erasure-status" && value.confirmed !== true)
            )
              throw new Error();
            receiptToken = value.receiptToken;
          } catch {
            return reply.code(400).send({ error: "invalid_request" });
          }
        } else if (
          request.headers["content-type"] !== undefined ||
          (request.headers["content-length"] !== undefined &&
            request.headers["content-length"] !== "0") ||
          (Buffer.isBuffer(request.body) && request.body.length)
        )
          return reply.code(400).send({ error: "invalid_request" });
        if (
          !deps.erasureRequests ||
          (method === "POST" &&
            suffix === "erasure-requests" &&
            (!deps.privacyEnabled || deps.erasureRequestsEnabled !== true))
        )
          return reply.code(503).send({ error: "erasure_unavailable" });
        const result =
          suffix === "erasure-status"
            ? await deps.erasureRequests.readReceipt(receiptToken)
            : method === "GET"
              ? await deps.erasureRequests.readOwned({
                  principalUserId: userId!,
                  targetUserId: userId!,
                })
              : await deps.erasureRequests.request({
                  principalUserId: userId!,
                  targetUserId: userId!,
                  receiptToken,
                });
        if (result.kind === "accepted" || result.kind === "found")
          return reply
            .code(result.kind === "accepted" ? 202 : 200)
            .send(result.request);
        return reply
          .code(
            result.kind === "denied"
              ? 403
              : result.kind === "conflict"
                ? 409
                : 503,
          )
          .send({
            error:
              result.kind === "denied"
                ? "forbidden"
                : result.kind === "conflict"
                  ? "conflict"
                  : "erasure_unavailable",
          });
      },
    });
  }
  const uuid =
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  for (const [method, suffix, pattern, booking] of [
    ["POST", "catalog-requests", /^\/v1\/browser\/catalog-requests$/u, false],
    [
      "GET",
      "catalog-requests/:id",
      new RegExp(`^/v1/browser/catalog-requests/${uuid}$`, "u"),
      false,
    ],
    [
      "GET",
      "bookings",
      /^\/v1\/browser\/bookings(?:\?after=bk1\.[A-Za-z0-9_-]{43})?$/u,
      true,
    ],
    ["POST", "bookings", /^\/v1\/browser\/bookings$/u, true],
    [
      "DELETE",
      "bookings/:handle",
      /^\/v1\/browser\/bookings\/bk1\.[A-Za-z0-9_-]{43}$/u,
      true,
    ],
  ] as const) {
    app.route({
      method,
      url: `/v1/browser/${suffix}`,
      bodyLimit: 1024,
      async handler(request, reply) {
        if (!pattern.test(request.raw.url ?? ""))
          return reply.code(400).send({ error: "invalid_request" });
        const token = await authenticated(request, reply);
        if (!token) return;
        if (!matchesSessionBinding(request, token))
          return reply.code(403).send({ error: "forbidden" });
        const framing = [
          "content-type",
          "content-length",
          "content-encoding",
          "transfer-encoding",
        ];
        if (
          framing.some((name) => headerCount(request, name) > 1) ||
          request.headers["content-encoding"] !== undefined ||
          request.headers["transfer-encoding"] !== undefined
        ) {
          return reply.code(400).send({ error: "invalid_request" });
        }
        const body = request.body;
        const length = request.headers["content-length"];
        if (method === "POST") {
          if (
            !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
              request.headers["content-type"] ?? "",
            ) ||
            !Buffer.isBuffer(body) ||
            body.length < 1 ||
            body.length > 1024 ||
            (length !== undefined && length !== String(body.length))
          )
            return reply.code(400).send({ error: "invalid_request" });
        } else if (
          request.headers["content-type"] !== undefined ||
          (length !== undefined && length !== "0") ||
          (Buffer.isBuffer(body) && body.length !== 0)
        )
          return reply.code(400).send({ error: "invalid_request" });
        if (booking) {
          if (deps.bookingEnabled !== true || !deps.bookingPrincipals)
            return reply.code(503).send({ error: "booking_unavailable" });
          const authority = await resolveClientPrincipal(
            deps.bookingPrincipals,
            `Bearer ${token}`,
          );
          if (authority.kind !== "resolved")
            return reply
              .code(authority.kind === "unavailable" ? 503 : 403)
              .send({ error: "booking_unavailable" });
          if (method === "POST" && deps.bookingReserveEnabled !== true)
            return reply.code(503).send({ error: "reserve_unavailable" });
        } else if (deps.catalogEnabled !== true)
          return reply.code(503).send({ error: "catalog_unavailable" });
        const response = await app.inject({
          method,
          url: request.raw.url!.replace("/v1/browser/", "/v1/client/"),
          headers: {
            authorization: `Bearer ${token}`,
            ...(method === "POST"
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(method === "POST" ? { payload: body as Buffer } : {}),
        });
        if (response.statusCode >= 500)
          return reply.code(503).send({ error: "temporarily_unavailable" });
        if (response.statusCode >= 400) {
          const errors: Record<number, string> = {
            400: "invalid_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
            429: "rate_limited",
          };
          return reply
            .code(response.statusCode)
            .send({ error: errors[response.statusCode] ?? "request_failed" });
        }
        return reply
          .code(response.statusCode)
          .type("application/json")
          .send(response.rawPayload);
      },
    });
  }
  for (const [method, suffix] of [
    ["GET", "consents"],
    ["GET", "export"],
    ["POST", "presentations"],
    ["POST", "decisions"],
    ["POST", "consents/withdraw"],
    ["POST", "erase"],
  ] as const) {
    app.route({
      method,
      url: `/v1/browser/privacy/${suffix}`,
      bodyLimit: 2048,
      async handler(request, reply) {
        const token = await authenticated(request, reply);
        if (!token) return;
        // Authenticate first (anonymous stays 401), then bind the read to the
        // session the calling tab knows, before forwarding any private snapshot.
        if (method === "GET" && !matchesSessionBinding(request, token))
          return reply.code(403).send({ error: "forbidden" });
        if (suffix === "erase")
          return reply.code(503).send({ error: "erasure_unavailable" });
        if (!deps.privacyEnabled)
          return reply.code(503).send({ error: "privacy_unavailable" });
        const response = await app.inject({
          method,
          url: `/v1/client/privacy/${suffix}`,
          headers: {
            authorization: `Bearer ${token}`,
            ...(method === "POST"
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(method === "POST" ? { payload: request.body as Buffer } : {}),
        });
        if (response.statusCode >= 500)
          return reply.code(503).send({ error: "privacy_unavailable" });
        reply
          .code(response.statusCode)
          .header("content-type", "application/json; charset=utf-8");
        if (suffix === "export" && response.statusCode === 200)
          reply.header(
            "content-disposition",
            'attachment; filename="my-data.json"',
          );
        return reply.send(response.rawPayload);
      },
    });
  }
};
