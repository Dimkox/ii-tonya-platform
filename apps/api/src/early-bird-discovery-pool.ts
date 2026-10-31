import { createDb } from "@ii-tonya/db";
/** Reuses the API source credential with a separate bounded, read-only session
 * pool. This grants no additional binding, sending or settlement capability. */
export function createEarlyBirdDiscoveryPool(databaseUrl: string) {
  return createDb(databaseUrl, {
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 4000,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
  });
}
