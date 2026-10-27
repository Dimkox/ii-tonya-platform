import { createHmac, randomBytes } from "node:crypto";
import { isIP, SocketAddress } from "node:net";
export type TelegramSecurityReason = "authentication_rejected" | "rate_limited";
/** Process-scoped correlation only; no configured secret or cross-restart identity. */
export function createSecurityEvent(key: Uint8Array = randomBytes(32)) {
  if (key.byteLength < 32) throw new Error("security_fingerprint_key_invalid");
  const ownedKey = Buffer.from(key);
  const hash = (domain: string, value: string) =>
    `h1:${createHmac("sha256", ownedKey).update(domain).update("\0").update(value).digest("hex")}`;
  return (reason: TelegramSecurityReason, ip: string, userAgent: unknown) => {
    const candidate = ip.toLowerCase().replace(/^::ffff:/u, "");
    const family = isIP(candidate);
    const normalizedIp =
      family === 6
        ? (SocketAddress.parse(`[${candidate}]:0`)?.address ?? "unknown")
        : family === 4
          ? candidate
          : "unknown";
    const ua = typeof userAgent === "string" ? userAgent.slice(0, 512) : "";
    return {
      event: "telegram_ingress_security" as const,
      reason,
      ipFingerprint: hash("ip", normalizedIp),
      uaFingerprint: hash("ua", ua),
    };
  };
}
