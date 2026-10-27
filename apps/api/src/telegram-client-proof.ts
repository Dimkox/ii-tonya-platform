import type { IdentityProofVerifier } from "@ii-tonya/application";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function createTelegramClientProofVerifier(options: {
  botToken: string;
  resolveIdentity: (externalId: string) => Promise<string | null>;
  now?: () => number;
  widgetEnabled?: boolean;
}): IdentityProofVerifier {
  if (!/^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/u.test(options.botToken))
    throw new Error("client_telegram_credential_required");
  const widgetFields = new Set([
    "id",
    "first_name",
    "last_name",
    "username",
    "photo_url",
    "auth_date",
    "hash",
  ]);
  const miniFields = new Set([
    "user",
    "auth_date",
    "hash",
    "signature",
    "query_id",
    "chat",
    "receiver",
    "chat_type",
    "chat_instance",
    "start_param",
    "can_send_after",
    "chat_join_request_query_id",
  ]);
  return {
    async verify(input) {
      if (
        input.signal.aborted ||
        input.expectedAudience !== "ii-tonya-client" ||
        input.expectedScope !== "client_session:create"
      )
        return null;
      const raw = input.identityProof;
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 6144) return null;
      const mode = raw.startsWith("mini:")
        ? "mini"
        : raw.startsWith("widget:")
          ? "widget"
          : null;
      if (
        mode === null ||
        (mode === "widget" && options.widgetEnabled !== true)
      )
        return null;
      const encoded = raw.slice(mode.length + 1);
      if (/%(?![0-9a-f]{2})/iu.test(encoded)) return null;
      const params = new URLSearchParams(encoded);
      const keys = [...params.keys()];
      if (
        keys.length > 16 ||
        new Set(keys).size !== keys.length ||
        keys.some((k) => !(mode === "mini" ? miniFields : widgetFields).has(k))
      )
        return null;
      if (
        [...params.values()].some((v) => /[\u0000-\u001f\u007f\ufffd]/u.test(v))
      )
        return null;
      const hash = params.get("hash");
      const timestamp = params.get("auth_date");
      if (
        !hash ||
        !/^[0-9a-f]{64}$/u.test(hash) ||
        !timestamp ||
        !/^[1-9][0-9]{9}$/u.test(timestamp)
      )
        return null;
      const authMs = Number(timestamp) * 1000;
      const now = (options.now ?? Date.now)();
      if (authMs > now + 30_000 || authMs <= now - 300_000) return null;
      params.delete("hash");
      params.sort();
      const check = [...params].map(([k, v]) => `${k}=${v}`).join("\n");
      // Telegram's bot-token HMAC includes signature; only Ed25519 excludes it.
      const key =
        mode === "mini"
          ? createHmac("sha256", "WebAppData").update(options.botToken).digest()
          : createHash("sha256").update(options.botToken).digest();
      const expected = createHmac("sha256", key).update(check).digest();
      if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return null;
      let id: unknown = params.get("id");
      if (mode === "mini") {
        const user = params.get("user");
        if (!user) return null;
        try {
          const parsed: unknown = JSON.parse(user);
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
          )
            return null;
          const object = parsed as Record<string, unknown>;
          // Telegram User is flat. Reject duplicate (including escaped) keys.
          const jsonKeys = [...user.matchAll(/("(?:\\.|[^"\\])*")\s*:/gu)].map(
            (m) => JSON.parse(m[1]!) as string,
          );
          if (
            jsonKeys.length !== Object.keys(object).length ||
            new Set(jsonKeys).size !== jsonKeys.length ||
            Object.values(object).some(
              (v) => v !== null && typeof v === "object",
            ) ||
            object.is_bot === true
          )
            return null;
          id = object.id;
          if (typeof id !== "number" || !Number.isSafeInteger(id)) return null;
        } catch {
          return null;
        }
      }
      const externalId = String(id);
      if (
        !/^[1-9][0-9]{0,15}$/u.test(externalId) ||
        !Number.isSafeInteger(Number(externalId))
      )
        return null;
      if (input.signal.aborted) return null;
      const userId = await options.resolveIdentity(externalId);
      if (userId === null || input.signal.aborted) return null;
      return {
        userId,
        audience: "ii-tonya-client",
        scope: "client_session:create",
        expiresAt: new Date(authMs + 300_000),
        replayDigest: `hmac-sha256:v1:${createHmac("sha256", options.botToken).update(`client-login:${mode}:${check}`).digest("hex")}`,
      };
    },
  };
}
