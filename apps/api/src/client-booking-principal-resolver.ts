import type {
  ClientPrincipal,
  ClientPrincipalResolution,
  ClientPrincipalResolver,
} from "@ii-tonya/application";

import {
  clientSessionTokenHash,
  parseClientBearer,
} from "./client-session-token.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const validate = (value: unknown): ClientPrincipalResolution => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "denied" };
  }
  const record = value as { kind?: unknown; principal?: unknown };
  if (record.kind === "denied" || record.kind === "unavailable") {
    return Object.keys(value).length === 1
      ? { kind: record.kind }
      : { kind: "denied" };
  }
  if (
    record.kind !== "resolved" ||
    Object.keys(value).length !== 2 ||
    typeof record.principal !== "object" ||
    record.principal === null ||
    Array.isArray(record.principal) ||
    Object.keys(record.principal).length !== 3
  ) {
    return { kind: "denied" };
  }
  const principal = record.principal as Partial<ClientPrincipal>;
  return principal.authenticated === true &&
    principal.active === true &&
    typeof principal.userId === "string" &&
    UUID_PATTERN.test(principal.userId) &&
    Object.keys(record.principal).every((key) =>
      ["authenticated", "active", "userId"].includes(key),
    )
    ? { kind: "resolved", principal: principal as ClientPrincipal }
    : { kind: "denied" };
};

export const createClientBookingPrincipalResolver = (repository: {
  resolveBooking(tokenDigest: `sha256:${string}`): Promise<unknown>;
}): ClientPrincipalResolver =>
  Object.freeze({
    async resolve(authorization: string): Promise<ClientPrincipalResolution> {
      const token = parseClientBearer(authorization);
      if (token === null) return { kind: "denied" };
      try {
        return validate(
          await repository.resolveBooking(clientSessionTokenHash(token)),
        );
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
