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
const principalKeys = new Set(["authenticated", "active", "userId"]);
const resolutionKeys = new Set(["kind", "principal"]);

const validatedPrincipal = (value: unknown): ClientPrincipal | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== principalKeys.size ||
    keys.some((key) => !principalKeys.has(key))
  ) {
    return null;
  }
  const principal = value as Partial<ClientPrincipal>;
  return principal.authenticated === true &&
    principal.active === true &&
    typeof principal.userId === "string" &&
    UUID_PATTERN.test(principal.userId)
    ? (principal as ClientPrincipal)
    : null;
};

const validatedResolution = (value: unknown): ClientPrincipalResolution => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "denied" };
  }
  const candidate = value as { kind?: unknown; principal?: unknown };
  if (candidate.kind === "denied" || candidate.kind === "unavailable") {
    return Object.keys(value).length === 1
      ? { kind: candidate.kind }
      : { kind: "denied" };
  }
  const keys = Object.keys(value);
  const principal = validatedPrincipal(candidate.principal);
  return candidate.kind === "resolved" &&
    principal !== null &&
    keys.length === resolutionKeys.size &&
    keys.every((key) => resolutionKeys.has(key))
    ? { kind: "resolved", principal }
    : { kind: "denied" };
};

export async function resolveClientPrincipal(
  resolver: ClientPrincipalResolver,
  authorization: string,
): Promise<ClientPrincipalResolution> {
  try {
    return validatedResolution(await resolver.resolve(authorization));
  } catch {
    return { kind: "unavailable" };
  }
}

export const createClientPrincipalResolver = (repository: {
  resolve(tokenDigest: `sha256:${string}`): Promise<unknown>;
}): ClientPrincipalResolver =>
  Object.freeze({
    async resolve(authorization: string): Promise<ClientPrincipalResolution> {
      const token = parseClientBearer(authorization);
      if (token === null) return { kind: "denied" };
      try {
        return validatedResolution(
          await repository.resolve(clientSessionTokenHash(token)),
        );
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
