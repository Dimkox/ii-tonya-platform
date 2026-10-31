import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";
import { requireWorkerPrincipal } from "./early-bird-worker-principal.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const capabilities = {
  wave: {
    role: "ii_tonya_worker_wave_retention",
    list: "public.early_bird_wave_retention_list(integer)",
    expire: "public.early_bird_wave_retention_expire(uuid,uuid)",
  },
  deferred: {
    role: "ii_tonya_worker_deferred_retention",
    list: "public.early_bird_deferred_retention_list(integer)",
    expire: "public.early_bird_deferred_retention_expire(uuid,uuid)",
  },
} as const;
/** Worker never gets table DELETE; the DB requires the durable gateway revoke. */
export class PostgresWorkerReceiptRetention {
  constructor(
    private readonly db: DrizzleDb,
    private readonly login: string,
    private readonly kind: keyof typeof capabilities,
  ) {}
  async listExpired(limit = 50): Promise<{ id: string; userId: string }[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("early_bird_retention_invalid");
    return this.db.transaction(async (tx) => {
      const cap = capabilities[this.kind];
      await requireWorkerPrincipal(
        tx,
        this.login,
        cap.role,
        cap.list,
        cap.expire,
      );
      const rows =
        this.kind === "wave"
          ? await tx.execute<{ id: string; userId: string }>(
              sql`select id,user_id as "userId" from public.early_bird_wave_retention_list(${limit})`,
            )
          : await tx.execute<{ id: string; userId: string }>(
              sql`select id,user_id as "userId" from public.early_bird_deferred_retention_list(${limit})`,
            );
      return rows.rows;
    });
  }
  async expireSelected(input: {
    id: string;
    userId: string;
  }): Promise<boolean> {
    if (!uuid.test(input.id) || !uuid.test(input.userId))
      throw new Error("early_bird_retention_invalid");
    return this.db.transaction(async (tx) => {
      const cap = capabilities[this.kind];
      await requireWorkerPrincipal(
        tx,
        this.login,
        cap.role,
        cap.list,
        cap.expire,
      );
      const rows =
        this.kind === "wave"
          ? await tx.execute<{ expired: boolean }>(
              sql`select public.early_bird_wave_retention_expire(${input.id}::uuid,${input.userId}::uuid) as expired`,
            )
          : await tx.execute<{ expired: boolean }>(
              sql`select public.early_bird_deferred_retention_expire(${input.id}::uuid,${input.userId}::uuid) as expired`,
            );
      return rows.rows[0]?.expired === true;
    });
  }
}
