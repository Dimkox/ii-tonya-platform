import { sql } from "@ii-tonya/db";
import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
import type { DrizzleDb } from "@ii-tonya/db";
type Transaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];
/** Called inside privacy transaction while capture's subject lock is held. */
export function createReceiptContactFence(
  gateway: ExperimentalGatewayIpc,
  keyVersion: string,
) {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(keyVersion))
    throw new Error("receipt_disclosure_key_version_invalid");
  return async (
    tx: Pick<Transaction, "execute">,
    userId: string,
  ): Promise<Error | undefined> => {
    try {
      const payer = (
        await tx.execute<{ id: string }>(
          sql`select id from payer_receipt_contacts where user_id=${userId}::uuid order by id`,
        )
      ).rows;
      const tables = (
        await tx.execute<{ present: boolean; deferredPresent: boolean }>(
          sql`select to_regclass('public.early_bird_receipt_contacts') is not null as present, to_regclass('public.early_bird_deferred_receipt_contacts') is not null as "deferredPresent"`,
        )
      ).rows[0];
      if (
        !tables ||
        typeof tables.present !== "boolean" ||
        typeof tables.deferredPresent !== "boolean"
      )
        throw new Error("receipt_disclosure_schema_unknown");
      const early = tables.present
        ? (
            await tx.execute<{ id: string }>(
              sql`select id from early_bird_receipt_contacts where user_id=${userId}::uuid order by id`,
            )
          ).rows
        : [];
      const deferred = tables.deferredPresent
        ? (
            await tx.execute<{ id: string }>(
              sql`select id from early_bird_deferred_receipt_contacts where user_id=${userId}::uuid order by id`,
            )
          ).rows
        : [];
      const contacts = [
        ...new Set([...payer, ...early, ...deferred].map((row) => row.id)),
      ].sort();
      for (const id of contacts) {
        const token = gateway.contactToken(id);
        await tx.execute(
          sql`insert into receipt_revocation_outbox(subject_id,contact_id,token,key_version) values(${userId}::uuid,${id}::uuid,${token},${keyVersion}) on conflict(token,key_version) do nothing`,
        );
      }
      const failures: unknown[] = [];
      if (contacts.length === 0) {
        try {
          await gateway.barrier();
        } catch (error) {
          failures.push(error);
        }
      }
      for (const id of contacts) {
        const token = gateway.contactToken(id);
        try {
          await gateway.revokeContactToken(token, id);
        } catch (error) {
          failures.push(error);
          continue;
        }
        await tx.execute(
          sql`delete from receipt_revocation_outbox where contact_id=${id}::uuid and token=${token} and key_version=${keyVersion}`,
        );
      }
      const remaining = (
        await tx.execute<{ pending: boolean }>(
          sql`select exists(select 1 from receipt_revocation_outbox where subject_id=${userId}::uuid  ) as pending`,
        )
      ).rows[0]?.pending;
      if (remaining !== false)
        failures.push(new Error("receipt_disclosure_pending"));
      if (failures.length) {
        try {
          await gateway.stopAll();
        } catch (error) {
          failures.push(error);
        }
        return new Error("receipt_disclosure_cancellation_uncertain", {
          cause: new AggregateError(failures),
        });
      }
      return undefined;
    } catch (error) {
      throw new Error("receipt_disclosure_capture_failed", { cause: error });
    }
  };
}
