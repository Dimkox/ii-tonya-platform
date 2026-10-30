import { sql } from "drizzle-orm";
import type { FinalCallConfigAuthority } from "../repositories/early-bird-final-call-queue.js";

/** Isolated queue tests only. Never use this synthetic authority in a runtime. */
export const syntheticFinalCallConfig: FinalCallConfigAuthority = {
  async lockCurrent() {
    return "wave-v1";
  },
  async lockCurrentState(tx) {
    const result = await tx.execute<{
      version: string;
      trigger: string;
      start: string;
    }>(sql`
      select config_version version,floor(extract(epoch from trigger_at)*1000)::bigint::text trigger,
        floor(extract(epoch from client_start_at)*1000)::bigint::text start
      from early_bird_final_call_queue where status='preparing' order by id limit 1
    `);
    const row = result.rows[0];
    return row
      ? {
          version: row.version,
          phase: "WAVE_1_EARLY_BIRD",
          triggerAtMs: Number(row.trigger),
          clientStartAtMs: Number(row.start),
        }
      : null;
  },
};
