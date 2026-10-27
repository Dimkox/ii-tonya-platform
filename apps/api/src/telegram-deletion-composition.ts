import { createHash, createHmac } from "node:crypto";
import {
  erasureReceiptDigest,
  type ErasureRequestService,
} from "@ii-tonya/application";
import type { PostgresErasureRequestRepository } from "@ii-tonya/db";
import type { TelegramDeletionCapability } from "./telegram-deletion.js";

/** Keys stay in this process; PostgreSQL stores only receipt/request digests. */
export function createTelegramDeletionCapability(deps: {
  enabled: boolean;
  botKey: string | undefined;
  botId: string | undefined;
  receiptKey: string | undefined;
  repository: Pick<PostgresErasureRequestRepository, "acceptTelegram">;
  service: Pick<ErasureRequestService, "readOwned">;
}): TelegramDeletionCapability | undefined {
  if (
    !deps.enabled ||
    !deps.botKey ||
    !deps.botId ||
    !/^[1-9]\d{0,19}$/u.test(deps.botId) ||
    !deps.receiptKey ||
    Buffer.byteLength(deps.receiptKey) < 32
  )
    return undefined;
  const receiptKey = deps.receiptKey;
  const botKey = deps.botKey;
  const botId = deps.botId;
  const replayHash = (domain: string, ...values: string[]) =>
    createHash("sha256")
      .update(`ii-tonya:telegram-erasure:${domain}:v1\0`)
      .update(JSON.stringify(values))
      .digest("hex");
  const mac = (domain: string, ...values: string[]) =>
    createHmac("sha256", receiptKey)
      .update(`ii-tonya:telegram-erasure:${domain}:v1\0`)
      .update(JSON.stringify(values));
  const token = (userId: string) =>
    `er1.${mac("receipt", botId, userId).digest("base64url")}`;
  return {
    async request(input) {
      const accepted = await deps.repository.acceptTelegram({
        botKey,
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        eventKey: replayHash("event", botId, input.updateId),
        payloadHash: replayHash(
          "payload",
          botId,
          input.telegramUserId,
          input.chatId,
          "/delete_data",
        ),
        receiptDigest: (userId) => erasureReceiptDigest(token(userId))!,
      });
      if (accepted.kind !== "accepted") return accepted;
      const view = await deps.service.readOwned({
        principalUserId: accepted.userId,
        targetUserId: accepted.userId,
      });
      if (
        view.kind !== "found" ||
        view.request.requestId !== accepted.request.id
      )
        return { kind: "unavailable" };
      return {
        kind: "accepted",
        request: view.request,
        ...(accepted.receiptAvailable
          ? { receiptToken: token(accepted.userId) }
          : {}),
      };
    },
  };
}
