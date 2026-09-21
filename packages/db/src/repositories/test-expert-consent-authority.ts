import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { currentConsentGrantedSql } from "./consent-current.js";

type Executor = Pick<DrizzleDb, "execute">;

export async function hasCurrentTestExpertConsent(
  executor: Executor,
  input: {
    userId: string;
    messagingPolicyVersion: string;
    selartiPolicyVersion?: string;
  },
): Promise<boolean> {
  // D2 карты W1: раньше здесь был `distinct on (consent_type) … order by created_at desc,
  // id desc`, где `id` — случайный uuid: при равных created_at выбор «последнего» ряда был
  // произвольным и расходился с read-гейтами эксперта. Теперь одна формула на весь репозиторий:
  // самое позднее мгновение, и любая не-granted запись в нём означает «не действует».
  const granted = async (
    purpose: string,
    policyVersion: string,
  ): Promise<boolean> => {
    const result = await executor.execute<{ granted: boolean }>(sql`
      select ${currentConsentGrantedSql({
        userExpression: sql`${input.userId}::uuid`,
        purpose,
        policyVersion: sql`${policyVersion}`,
      })} as granted
    `);
    return result.rows[0]?.granted === true;
  };

  if (!(await granted("client_messaging", input.messagingPolicyVersion)))
    return false;
  if (
    input.selartiPolicyVersion !== undefined &&
    !(await granted("selarti_ai_processing", input.selartiPolicyVersion))
  )
    return false;
  return true;
}
