import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { currentConsentGrantedSql } from "./consent-current.js";

/**
 * EGRESS-01 (приёмка T18/T25): повторная сверка согласия непосредственно перед сетевым
 * вызовом. Окно между выдачей строки из очереди и отправкой — не формальность: отзыв
 * в эти секунды иначе уходит клиенту.
 *
 * Неизвестный субъект (диалог удалён, согласия нет, ничья в одном мгновении) = не разрешено.
 */
export const createConsentEgressGate = (
  db: Pick<DrizzleDb, "execute">,
  purpose = "client_messaging",
) =>
  Object.freeze({
    async allowsSend(dialogueId: string): Promise<boolean> {
      const row = (
        await db.execute<{ allowed: boolean }>(sql`
          select exists (
            select 1
            from dialogues gated
            where gated.id = ${dialogueId}::uuid
              and ${currentConsentGrantedSql({
                userExpression: sql`gated.user_id`,
                purpose,
              })}
          ) as allowed
        `)
      ).rows[0];
      return row?.allowed === true;
    },
  });
