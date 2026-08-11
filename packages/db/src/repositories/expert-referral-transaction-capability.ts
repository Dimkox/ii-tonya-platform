import { sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DrizzleDb } from "../client.js";

const transactions = new WeakMap<object, object>();

export type TrustedExpertReferralTransaction = object & {
  readonly __expertReferralTransactionCapability: never;
};

function registerTrustedExpertReferralTransaction(
  candidate: object,
): TrustedExpertReferralTransaction {
  const handle = candidate as Record<string, unknown>;
  if (
    "$client" in handle ||
    typeof handle.execute !== "function" ||
    typeof handle.transaction !== "function"
  ) {
    throw new Error("transaction_handle_required");
  }
  const capability = Object.freeze({}) as TrustedExpertReferralTransaction;
  transactions.set(capability, candidate);
  return capability;
}

export function withTrustedExpertReferralTransaction<T>(
  db: DrizzleDb,
  callback: (
    tx: Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0],
    capability: TrustedExpertReferralTransaction,
  ) => Promise<T>,
): Promise<T> {
  if (!(db instanceof NodePgDatabase) || !(db.$client instanceof Pool)) {
    throw new Error("database_handle_required");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level serializable`);
    const capability = registerTrustedExpertReferralTransaction(tx);
    return callback(tx, capability);
  });
}

export function assertTrustedExpertReferralTransaction(
  capability: object,
  candidate: object,
): asserts capability is TrustedExpertReferralTransaction {
  if (transactions.get(capability) !== candidate) {
    throw new Error("transaction_capability_mismatch");
  }
}
