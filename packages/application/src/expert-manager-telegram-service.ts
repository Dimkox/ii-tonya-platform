import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { ExpertVerificationService } from "./expert-verification-service.js";
export interface ExpertManagerTelegramRepository {
  createPairing(input: {
    sessionHash: string;
    botId: string;
    tokenHash: string;
  }): Promise<void>;
  pair(input: {
    botId: string;
    tokenHash: string;
    telegramUserId: string;
    chatId: string;
  }): Promise<boolean>;
  resolveCallback(input: {
    botId: string;
    nonceHash: string;
    telegramUserId: string;
    chatId: string;
  }): Promise<{
    sessionHash: string;
    applicationId: string;
    decision: "approved" | "rejected";
    idempotencyKey: string;
    requiresEditor?: boolean;
    profileUserId?: string;
    profileRevision?: number;
  } | null>;
  claimNotification(botId: string): Promise<{
    id: string;
    fence: string;
    chatId: string;
    approveNonceHash: string;
    rejectNonceHash: string;
    text?: string;
  } | null>;
  finishNotification(
    id: string,
    fence: string,
    messageId: string,
  ): Promise<void>;
}
export interface ExpertManagerTelegramTransport {
  sendMessage(input: {
    chatId: string;
    text: string;
    replyMarkup: {
      inline_keyboard: readonly (readonly {
        text: string;
        callback_data: string;
      }[])[];
    };
    protectContent: true;
  }): Promise<{ messageId: string }>;
}
const identity = (user: string, chat: string) =>
  /^[1-9]\d{0,15}$/u.test(user) && user === chat;
export function createExpertManagerTelegramService(deps: {
  enabled: boolean;
  botId: string;
  secret: Uint8Array;
  repository: ExpertManagerTelegramRepository;
  verification: Pick<ExpertVerificationService, "decide">;
  transport: ExpertManagerTelegramTransport;
  verifyProfile?: (input: {
    sessionHash: string;
    userId: string;
    revision: number;
  }) => Promise<unknown>;
}) {
  if (
    deps.enabled &&
    (!/^[1-9]\d{0,15}$/u.test(deps.botId) || deps.secret.byteLength < 32)
  )
    throw new Error("manager_telegram_configuration_invalid");
  const mac = (hash: string) =>
    createHmac("sha256", deps.secret)
      .update("ii-tonya:manager-callback:v1\0")
      .update(deps.botId)
      .update("\0")
      .update(hash)
      .digest()
      .subarray(0, 12);
  // 32-byte nonce reference + 12-byte MAC keeps callback_data below Telegram's 64-byte limit.
  const signCallback = (hash: string) => {
    if (!/^[a-f0-9]{64}$/u.test(hash))
      throw new Error("manager_callback_invalid");
    const ref = Buffer.from(hash, "hex");
    return `mt1.${Buffer.concat([ref, mac(hash)]).toString("base64url")}`;
  };

  const decode = (token: string) => {
    const bytes = Buffer.from(token.slice(4), "base64url");
    if (
      !token.startsWith("mt1.") ||
      bytes.length !== 44 ||
      `mt1.${bytes.toString("base64url")}` !== token
    )
      return null;
    const hash = bytes.subarray(0, 32).toString("hex");
    return timingSafeEqual(bytes.subarray(32), mac(hash)) ? hash : null;
  };
  return {
    signCallback,
    async createPairing(sessionHash: string) {
      if (!deps.enabled) return { kind: "disabled" } as const;
      try {
        const token = randomBytes(32).toString("base64url");
        await deps.repository.createPairing({
          sessionHash,
          botId: deps.botId,
          tokenHash: createHash("sha256").update(token).digest("hex"),
        });
        return { kind: "ok", token } as const;
      } catch {
        return { kind: "forbidden" } as const;
      }
    },
    async pair(telegramUserId: string, chatId: string, token: string) {
      if (!deps.enabled) return { kind: "disabled" } as const;
      if (
        !identity(telegramUserId, chatId) ||
        !/^[A-Za-z0-9_-]{43}$/u.test(token)
      )
        return { kind: "forbidden" } as const;
      try {
        return {
          kind: (await deps.repository.pair({
            botId: deps.botId,
            telegramUserId,
            chatId,
            tokenHash: createHash("sha256").update(token).digest("hex"),
          }))
            ? "ok"
            : "forbidden",
        } as const;
      } catch {
        return { kind: "forbidden" } as const;
      }
    },
    async callback(telegramUserId: string, chatId: string, token: string) {
      if (!deps.enabled) return { kind: "disabled" } as const;
      if (!identity(telegramUserId, chatId))
        return { kind: "forbidden" } as const;
      try {
        const nonceHash = decode(token);
        if (!nonceHash) return { kind: "forbidden" } as const;
        const stored = await deps.repository.resolveCallback({
          botId: deps.botId,
          telegramUserId,
          chatId,
          nonceHash,
        });
        if (!stored) return { kind: "forbidden" } as const;
        if (stored.requiresEditor) return { kind: "editor_required" } as const;
        if (
          stored.decision === "approved" &&
          stored.profileUserId &&
          stored.profileRevision
        ) {
          if (!deps.verifyProfile) return { kind: "unavailable" } as const;
          await deps.verifyProfile({
            sessionHash: stored.sessionHash,
            userId: stored.profileUserId,
            revision: stored.profileRevision,
          });
        }
        return await deps.verification.decide(stored.sessionHash, {
          applicationId: stored.applicationId,
          decision: stored.decision,
          reasonCode: "telegram_manager_review",
          idempotencyKey: stored.idempotencyKey,
        });
      } catch {
        return { kind: "unavailable" } as const;
      }
    },
    async tick() {
      let sent = 0;
      if (!deps.enabled) return { sent };
      for (let count = 0; count < 25; count++) {
        const item = await deps.repository.claimNotification(deps.botId);
        if (!item) break;
        try {
          const result = await deps.transport.sendMessage({
            chatId: item.chatId,
            text: item.text ?? "Новая заявка на проверку",
            protectContent: true,
            replyMarkup: {
              inline_keyboard: [
                [
                  {
                    text: "Одобрить",
                    callback_data: signCallback(item.approveNonceHash),
                  },
                  {
                    text: "Отклонить",
                    callback_data: signCallback(item.rejectNonceHash),
                  },
                ],
              ],
            },
          });
          if (!/^[1-9]\d{0,19}$/u.test(result.messageId)) continue;
          await deps.repository.finishNotification(
            item.id,
            item.fence,
            result.messageId,
          );
          sent++;
        } catch {
          /* Ambiguous sends remain quarantined; never blindly resend. */
        }
      }
      return { sent };
    },
  };
}
export type ExpertManagerTelegramService = ReturnType<
  typeof createExpertManagerTelegramService
>;
