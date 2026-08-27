import { createHash, randomBytes } from "node:crypto";

export type ClientSessionToken = `cs1.${string}`;
export type ClientSessionTokenDigest = `sha256:${string}`;

export const createClientSessionToken = (
  random: (size: number) => Buffer = randomBytes,
): ClientSessionToken => `cs1.${random(32).toString("base64url")}`;

export const clientSessionTokenHash = (
  token: ClientSessionToken,
): ClientSessionTokenDigest =>
  `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;

export const parseClientBearer = (
  authorization: string | readonly string[] | undefined,
): ClientSessionToken | null => {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer (cs1\.[A-Za-z0-9_-]{43})$/u.exec(authorization);
  return match?.[1] as ClientSessionToken | undefined ?? null;
};
