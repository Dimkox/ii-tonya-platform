import {
  ClientBookingConflictError,
  ClientBookingInvalidRequestError,
  ClientBookingNotFoundError,
  type ClientBookingService,
  type ClientPrincipalResolver,
  WaitlistConflictError,
  WaitlistInvalidRequestError,
  WaitlistNotFoundError,
  type WaitlistService,
} from "@ii-tonya/application";
import type { FastifyPluginAsync } from "fastify";

import { readExactAuthorization } from "../authorization-header.js";
import { parseClientBookingBody } from "../client-booking-body.js";
import { resolveClientPrincipal } from "../client-principal-resolver.js";

interface RouteOptions {
  readonly principals: ClientPrincipalResolver;
  readonly bookings: ClientBookingService;
  readonly waitlist?: WaitlistService;
  readonly reserveEnabled: boolean;
  readonly waitlistEnabled: boolean;
  readonly metrics?: {
    record(labels: {
      operation: "reserve" | "cancel" | "reschedule" | "waitlist";
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

const parseChoiceBody = (
  rawHeaders: readonly string[],
  body: Buffer,
): { choiceHandle: string } | null => {
  const contentType = rawHeader(rawHeaders, "content-type");
  const contentEncoding = rawHeader(rawHeaders, "content-encoding");
  const contentLength = rawHeader(rawHeaders, "content-length");
  const transferEncoding = rawHeader(rawHeaders, "transfer-encoding");
  if (
    !contentType.valid ||
    !contentEncoding.valid ||
    !contentLength.valid ||
    !transferEncoding.valid
  )
    return null;
  return parseClientBookingBody({
    body,
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
};

const hasStrictEmptyBody = (
  rawHeaders: readonly string[],
  body: Buffer | undefined,
): boolean => {
  const contentType = rawHeader(rawHeaders, "content-type");
  const contentEncoding = rawHeader(rawHeaders, "content-encoding");
  const contentLength = rawHeader(rawHeaders, "content-length");
  const transferEncoding = rawHeader(rawHeaders, "transfer-encoding");
  return (
    contentType.valid &&
    contentType.value === undefined &&
    contentEncoding.valid &&
    contentEncoding.value === undefined &&
    transferEncoding.valid &&
    transferEncoding.value === undefined &&
    contentLength.valid &&
    (contentLength.value === undefined || contentLength.value === "0") &&
    (!Buffer.isBuffer(body) || body.byteLength === 0)
  );
};

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
        return reply.code(200).send(result);
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

  app.post<{
    Params: { bookingHandle: string };
    Body: Buffer;
  }>(
    "/v1/client/bookings/:bookingHandle/reschedule",
    { bodyLimit: 1_024 },
    async (request, reply) => {
      noStore(reply);
      const rawPath =
        /^\/v1\/client\/bookings\/(bk1\.[A-Za-z0-9_-]{43})\/reschedule$/u.exec(
          request.raw.url ?? "",
        );
      const body = parseChoiceBody(request.raw.rawHeaders, request.body);
      if (rawPath === null || body === null) {
        deps.metrics?.record({ operation: "reschedule", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resolution = await authorize(
        request.raw.rawHeaders,
        deps.principals,
      );
      if (resolution.kind === "denied")
        return reply.code(401).send({ error: "unauthorized" });
      if (resolution.kind === "unavailable")
        return reply.code(503).send({ error: "temporarily_unavailable" });
      try {
        const result = await deps.bookings.reschedule(
          resolution.principal,
          rawPath[1]!,
          body,
        );
        deps.metrics?.record({
          operation: "reschedule",
          outcome: result.replayed ? "replayed" : "created",
        });
        return reply.code(result.replayed ? 200 : 201).send({
          bookingHandle: result.bookingHandle,
          state: result.state,
          reservedUntil: result.reservedUntil,
        });
      } catch (error) {
        if (error instanceof ClientBookingInvalidRequestError) {
          deps.metrics?.record({ operation: "reschedule", outcome: "invalid" });
          return reply.code(400).send({ error: "invalid_request" });
        }
        if (error instanceof ClientBookingNotFoundError) {
          deps.metrics?.record({
            operation: "reschedule",
            outcome: "not_found",
          });
          return reply.code(404).send({ error: "not_found" });
        }
        if (error instanceof ClientBookingConflictError) {
          deps.metrics?.record({
            operation: "reschedule",
            outcome: "conflict",
          });
          return reply.code(409).send({ error: "conflict" });
        }
        deps.metrics?.record({ operation: "reschedule", outcome: "failed" });
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post<{ Body: Buffer }>(
    "/v1/client/waitlist",
    { bodyLimit: 1_024 },
    async (request, reply) => {
      noStore(reply);
      const body = parseChoiceBody(request.raw.rawHeaders, request.body);
      if (body === null) {
        deps.metrics?.record({ operation: "waitlist", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resolution = await authorize(
        request.raw.rawHeaders,
        deps.principals,
      );
      if (resolution.kind === "denied")
        return reply.code(401).send({ error: "unauthorized" });
      if (resolution.kind === "unavailable")
        return reply.code(503).send({ error: "temporarily_unavailable" });
      if (!deps.waitlistEnabled) {
        deps.metrics?.record({ operation: "waitlist", outcome: "disabled" });
        return reply.code(503).send({ error: "feature_disabled" });
      }
      try {
        const result = await deps.waitlist!.join(resolution.principal, body);
        deps.metrics?.record({
          operation: "waitlist",
          outcome: result.replayed ? "replayed" : "created",
        });
        return reply.code(result.replayed ? 200 : 201).send({
          waitlistHandle: result.waitlistHandle,
          position: result.position,
        });
      } catch (error) {
        if (error instanceof WaitlistInvalidRequestError) {
          deps.metrics?.record({ operation: "waitlist", outcome: "invalid" });
          return reply.code(400).send({ error: "invalid_request" });
        }
        if (error instanceof WaitlistNotFoundError) {
          deps.metrics?.record({ operation: "waitlist", outcome: "not_found" });
          return reply.code(404).send({ error: "not_found" });
        }
        if (error instanceof WaitlistConflictError) {
          deps.metrics?.record({ operation: "waitlist", outcome: "conflict" });
          return reply.code(409).send({ error: "conflict" });
        }
        deps.metrics?.record({ operation: "waitlist", outcome: "failed" });
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.delete<{ Params: { waitlistHandle: string }; Body: Buffer | undefined }>(
    "/v1/client/waitlist/:waitlistHandle",
    async (request, reply) => {
      noStore(reply);
      const rawPath =
        /^\/v1\/client\/waitlist\/(wl1\.[A-Za-z0-9_-]{43})$/u.exec(
          request.raw.url ?? "",
        );
      if (
        rawPath === null ||
        !hasStrictEmptyBody(request.raw.rawHeaders, request.body)
      ) {
        deps.metrics?.record({ operation: "waitlist", outcome: "invalid" });
        return reply.code(400).send({ error: "invalid_request" });
      }
      const resolution = await authorize(
        request.raw.rawHeaders,
        deps.principals,
      );
      if (resolution.kind === "denied")
        return reply.code(401).send({ error: "unauthorized" });
      if (resolution.kind === "unavailable")
        return reply.code(503).send({ error: "temporarily_unavailable" });
      if (!deps.waitlistEnabled) {
        deps.metrics?.record({ operation: "waitlist", outcome: "disabled" });
        return reply.code(503).send({ error: "feature_disabled" });
      }
      try {
        const result = await deps.waitlist!.leave(
          resolution.principal,
          rawPath[1]!,
        );
        deps.metrics?.record({ operation: "waitlist", outcome: "cancelled" });
        return reply.code(200).send({
          waitlistHandle: result.waitlistHandle,
          state: result.state,
        });
      } catch (error) {
        if (error instanceof WaitlistInvalidRequestError) {
          deps.metrics?.record({ operation: "waitlist", outcome: "invalid" });
          return reply.code(400).send({ error: "invalid_request" });
        }
        if (error instanceof WaitlistNotFoundError) {
          deps.metrics?.record({ operation: "waitlist", outcome: "not_found" });
          return reply.code(404).send({ error: "not_found" });
        }
        if (error instanceof WaitlistConflictError) {
          deps.metrics?.record({ operation: "waitlist", outcome: "conflict" });
          return reply.code(409).send({ error: "conflict" });
        }
        deps.metrics?.record({ operation: "waitlist", outcome: "failed" });
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
