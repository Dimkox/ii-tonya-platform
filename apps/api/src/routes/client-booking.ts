import {
  ClientBookingConflictError,
  ClientBookingInvalidRequestError,
  ClientBookingNotFoundError,
  type ClientBookingService,
  type ClientPrincipalResolver,
} from "@ii-tonya/application";
import type { FastifyPluginAsync } from "fastify";

import { readExactAuthorization } from "../authorization-header.js";
import { parseClientBookingBody } from "../client-booking-body.js";
import { resolveClientPrincipal } from "../client-principal-resolver.js";

interface RouteOptions {
  readonly principals: ClientPrincipalResolver;
  readonly bookings: ClientBookingService;
  readonly reserveEnabled: boolean;
  readonly metrics?: {
    record(labels: {
      operation: "reserve" | "cancel";
      outcome:
        | "created"
        | "replayed"
        | "cancelled"
        | "not_found"
        | "conflict"
        | "invalid"
        | "disabled"
        | "failed";
    }): void;
  };
}

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

export const clientBookingRoutes: FastifyPluginAsync<RouteOptions> = async (
  app,
  deps,
) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) =>
    done(null, body),
  );
  app.setErrorHandler((error, _request, reply) => {
    reply.header("cache-control", "no-store");
    if ((error as { code?: unknown }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.code(400).send({ error: "invalid_request" });
    }
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/v1/client/bookings", async (request, reply) => {
    noStore(reply);
    const path =
      /^\/v1\/client\/bookings(?:\?after=(bk1\.[A-Za-z0-9_-]{43}))?$/u.exec(
        request.raw.url ?? "",
      );
    const framed = [
      "content-type",
      "content-encoding",
      "transfer-encoding",
    ].some((name) => {
      const header = rawHeader(request.raw.rawHeaders, name);
      return !header.valid || header.value !== undefined;
    });
    const length = rawHeader(request.raw.rawHeaders, "content-length");
    if (
      path === null ||
      framed ||
      !length.valid ||
      (length.value !== undefined && length.value !== "0")
    ) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const resolution = await authorize(request.raw.rawHeaders, deps.principals);
    if (resolution.kind === "denied")
      return reply.code(401).send({ error: "unauthorized" });
    if (resolution.kind === "unavailable")
      return reply.code(503).send({ error: "temporarily_unavailable" });
    try {
      return reply.send(
        await deps.bookings.list(resolution.principal, path[1]),
      );
    } catch (error) {
      if (error instanceof ClientBookingNotFoundError)
        return reply.code(404).send({ error: "not_found" });
      if (error instanceof ClientBookingInvalidRequestError)
        return reply.code(400).send({ error: "invalid_request" });
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post<{ Body: Buffer }>(
    "/v1/client/bookings",
    { bodyLimit: 1_024 },
    async (request, reply) => {
      noStore(reply);
      const contentType = rawHeader(request.raw.rawHeaders, "content-type");
      const contentEncoding = rawHeader(
        request.raw.rawHeaders,
        "content-encoding",
      );
      const contentLength = rawHeader(request.raw.rawHeaders, "content-length");
      const transferEncoding = rawHeader(
        request.raw.rawHeaders,
        "transfer-encoding",
      );
      if (
        !contentType.valid ||
        !contentEncoding.valid ||
        !contentLength.valid ||
        !transferEncoding.valid
      ) {
        deps.metrics?.record({ operation: "reserve", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const body = parseClientBookingBody({
        body: request.body,
        ...(contentType.value === undefined
          ? {}
          : { contentType: contentType.value }),
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
      if (body === null) {
        deps.metrics?.record({ operation: "reserve", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resolution = await authorize(
        request.raw.rawHeaders,
        deps.principals,
      );
      if (resolution.kind === "denied") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      noStore(reply);
      if (resolution.kind === "unavailable") {
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
      if (!deps.reserveEnabled) {
        deps.metrics?.record({ operation: "reserve", outcome: "disabled" });
        return reply.code(503).send({ error: "feature_disabled" });
      }
      try {
        const result = await deps.bookings.reserve(resolution.principal, body);
        deps.metrics?.record({
          operation: "reserve",
          outcome: result.created ? "created" : "replayed",
        });
        return reply.code(result.created ? 201 : 200).send({
          bookingHandle: result.bookingHandle,
          state: result.state,
          reservedUntil: result.reservedUntil,
        });
      } catch (error) {
        if (error instanceof ClientBookingInvalidRequestError) {
          deps.metrics?.record({ operation: "reserve", outcome: "invalid" });
          return reply.code(400).send({ error: "invalid_request" });
        }
        if (error instanceof ClientBookingNotFoundError) {
          deps.metrics?.record({ operation: "reserve", outcome: "not_found" });
          return reply.code(404).send({ error: "not_found" });
        }
        if (error instanceof ClientBookingConflictError) {
          deps.metrics?.record({ operation: "reserve", outcome: "conflict" });
          return reply.code(409).send({ error: "conflict" });
        }
        deps.metrics?.record({ operation: "reserve", outcome: "failed" });
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.delete<{ Params: { bookingHandle: string }; Body: Buffer | undefined }>(
    "/v1/client/bookings/:bookingHandle",
    async (request, reply) => {
      noStore(reply);
      const rawPath =
        /^\/v1\/client\/bookings\/(bk1\.[A-Za-z0-9_-]{43})$/u.exec(
          request.raw.url ?? "",
        );
      if (rawPath === null) {
        deps.metrics?.record({ operation: "cancel", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const contentType = rawHeader(request.raw.rawHeaders, "content-type");
      const contentEncoding = rawHeader(
        request.raw.rawHeaders,
        "content-encoding",
      );
      const contentLength = rawHeader(request.raw.rawHeaders, "content-length");
      const transferEncoding = rawHeader(
        request.raw.rawHeaders,
        "transfer-encoding",
      );
      if (
        !contentType.valid ||
        contentType.value !== undefined ||
        !contentEncoding.valid ||
        contentEncoding.value !== undefined ||
        !transferEncoding.valid ||
        transferEncoding.value !== undefined ||
        !contentLength.valid ||
        (contentLength.value !== undefined && contentLength.value !== "0") ||
        (Buffer.isBuffer(request.body) && request.body.byteLength !== 0)
      ) {
        deps.metrics?.record({ operation: "cancel", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resolution = await authorize(
        request.raw.rawHeaders,
        deps.principals,
      );
      if (resolution.kind === "denied") {
        return reply.code(401).send({ error: "unauthorized" });
      }
      noStore(reply);
      if (resolution.kind === "unavailable") {
        return reply.code(503).send({ error: "temporarily_unavailable" });
      }
      try {
        const result = await deps.bookings.cancel(
          resolution.principal,
          rawPath[1]!,
        );
        deps.metrics?.record({ operation: "cancel", outcome: "cancelled" });
        return reply
          .code(result.state === "cancellation_pending" ? 202 : 200)
          .send(result);
      } catch (error) {
        if (error instanceof ClientBookingInvalidRequestError) {
          deps.metrics?.record({ operation: "cancel", outcome: "invalid" });
          return reply.code(400).send({ error: "invalid_request" });
        }
        if (error instanceof ClientBookingNotFoundError) {
          deps.metrics?.record({ operation: "cancel", outcome: "not_found" });
          return reply.code(404).send({ error: "not_found" });
        }
        if (error instanceof ClientBookingConflictError) {
          deps.metrics?.record({ operation: "cancel", outcome: "conflict" });
          return reply.code(409).send({ error: "conflict" });
        }
        deps.metrics?.record({ operation: "cancel", outcome: "failed" });
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
