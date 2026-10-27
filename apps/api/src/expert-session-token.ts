import { createHash, randomBytes } from "node:crypto";
export function createExpertSessionToken(): `es1.${string}` {
  return `es1.${randomBytes(32).toString("base64url")}`;
}
export const expertSessionTokenHash = (token: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(token).digest("hex")}`;
export function parseExpertBearer(value: unknown): `es1.${string}` | null {
  if (typeof value !== "string") return null;
  const match = /^Bearer (es1\.([A-Za-z0-9_-]{43}))$/u.exec(value);
  if (
    !match ||
    match[0] !== value ||
    Buffer.from(match[2]!, "base64url").toString("base64url") !== match[2]
  )
    return null;
  return match[1] as `es1.${string}`;
}
