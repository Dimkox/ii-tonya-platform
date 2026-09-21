import { randomUUID } from "node:crypto";
import type {
  ClientPrincipalResolver,
  PrivacyService,
} from "@ii-tonya/application";
import type { FastifyPluginAsync } from "fastify";

import { readExactAuthorization } from "../authorization-header.js";
import { resolveClientPrincipal } from "../client-principal-resolver.js";

interface RouteOptions {
  readonly privacy: PrivacyService;
  readonly principals: ClientPrincipalResolver;
  readonly metrics?: {
    record(labels: {
      operation: "list" | "withdraw";
      outcome:
        "ok" | "denied" | "unavailable" | "invalid" | "disabled" | "failed";
    }): void;
  };
}

const PURPOSE = /^[a-z][a-z0-9_]{1,63}$/u;
const POLICY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

type RawHeader = { readonly valid: boolean; readonly value?: string };
const rawHeader = (headers: readonly string[], name: string): RawHeader => {
  if (headers.length % 2 !== 0) return { valid: false };
  const values: string[] = [];
  for (let index = 0; index < headers.length; index += 2) {
    if (headers[index]?.toLowerCase() === name) {
      const value = headers[index + 1];
      if (value === undefined) return { valid: false };
      values.push(value);
    }
  }
  return values.length > 1
    ? { valid: false }
    : values[0] === undefined
      ? { valid: true }
      : { valid: true, value: values[0] };
};

const authorize = async (
  rawHeaders: readonly string[],
  principals: ClientPrincipalResolver,
) => {
  const authorization = readExactAuthorization(rawHeaders);
  return authorization === null
    ? ({ kind: "denied" } as const)
    : resolveClientPrincipal(principals, authorization);
};

const noStore = <T extends { header(name: string, value: string): T }>(
  reply: T,
): T => reply.header("cache-control", "no-store");

/**
 * Только `{"purpose":…,"policyVersion":…}`, только application/json, без неизвестных
 * полей: отзыв по лишнему ключу или по подставленной кодировке — это не тот отзыв.
 */
const parseWithdrawBody = (
  body: unknown,
  headers: readonly string[],
): { purpose: string; policyVersion: string } | null => {
  const contentType = rawHeader(headers, "content-type");
  const contentEncoding = rawHeader(headers, "content-encoding");
  const transferEncoding = rawHeader(headers, "transfer-encoding");
  if (
    !contentType.valid ||
    !contentEncoding.valid ||
    !transferEncoding.valid ||
    contentEncoding.value !== undefined ||
    transferEncoding.value !== undefined ||
    contentType.value !== "application/json"
  )
    return null;
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return null;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.every((key) => key in WITHDRAW_KEYS))
    return null;
  const value = body as { purpose?: unknown; policyVersion?: unknown };
  if (typeof value.purpose !== "string" || !PURPOSE.test(value.purpose))
    return null;
  if (
    typeof value.policyVersion !== "string" ||
    !POLICY_VERSION.test(value.policyVersion)
  )
    return null;
  return { purpose: value.purpose, policyVersion: value.policyVersion };
};

const WITHDRAW_KEYS = { purpose: true, policyVersion: true } as const;

export const clientPrivacyRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  deps,
) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );

  app.get("/v1/client/privacy/consents", async (request, reply) => {
    noStore(reply);
    const resolution = await authorize(request.raw.rawHeaders, deps.principals);
    if (resolution.kind === "unavailable") {
      deps.metrics?.record({ operation: "list", outcome: "unavailable" });
      return reply.code(503).send({ error: "principal_unavailable" });
    }
    if (resolution.kind !== "resolved") {
      deps.metrics?.record({ operation: "list", outcome: "denied" });
      return reply.code(401).send({ error: "unauthorized" });
    }
    const userId = resolution.principal.userId;
    try {
      const consents = await deps.privacy.listConsents({
        principalUserId: userId,
        targetUserId: userId,
      });
      deps.metrics?.record({ operation: "list", outcome: "ok" });
      return reply.code(200).send({ consents });
    } catch {
      deps.metrics?.record({ operation: "list", outcome: "failed" });
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post(
    "/v1/client/privacy/consents/withdraw",
    { bodyLimit: 1_024 },
    async (request, reply) => {
      noStore(reply);
      const resolution = await authorize(
        request.raw.rawHeaders,
        deps.principals,
      );
      if (resolution.kind === "unavailable") {
        deps.metrics?.record({ operation: "withdraw", outcome: "unavailable" });
        return reply.code(503).send({ error: "principal_unavailable" });
      }
      if (resolution.kind !== "resolved") {
        deps.metrics?.record({ operation: "withdraw", outcome: "denied" });
        return reply.code(401).send({ error: "unauthorized" });
      }
      let json: unknown;
      try {
        json = JSON.parse((request.body as Buffer).toString("utf8"));
      } catch {
        json = null;
      }
      const body = parseWithdrawBody(json, request.raw.rawHeaders);
      if (body === null) {
        deps.metrics?.record({ operation: "withdraw", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const userId = resolution.principal.userId;
      try {
        await deps.privacy.withdrawConsent({
          principalUserId: userId,
          targetUserId: userId,
          purpose: body.purpose,
          policyVersion: body.policyVersion,
          correlationId: randomUUID(),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        if (reason === "Privacy mutations are disabled") {
          deps.metrics?.record({ operation: "withdraw", outcome: "disabled" });
          return reply.code(503).send({ error: "privacy_disabled" });
        }
        if (reason === "Unknown privacy consent purpose") {
          deps.metrics?.record({ operation: "withdraw", outcome: "invalid" });
          return reply.code(400).send({ error: "unknown_purpose" });
        }
        deps.metrics?.record({ operation: "withdraw", outcome: "failed" });
        return reply.code(500).send({ error: "internal_error" });
      }
      deps.metrics?.record({ operation: "withdraw", outcome: "ok" });
      return reply.code(204).send();
    },
  );
};
