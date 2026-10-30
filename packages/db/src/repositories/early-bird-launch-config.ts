import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../client.js";

/** Hold the active generation's share lock until the caller's transaction commits. */
export class EarlyBirdLaunchConfigAuthority {
  async lockCurrentState(tx: Pick<DrizzleDb, "execute">): Promise<{
    version: string;
    phase: "WAVE_1_EARLY_BIRD" | "PUBLIC_LAUNCH";
    triggerAtMs: number;
    clientStartAtMs: number;
  } | null> {
    const result = await tx.execute<{
      id: string;
      phase: string;
      trigger_ms: string;
      client_start_ms: string;
    }>(sql`
      select id,phase,(extract(epoch from final_call_trigger_at)*1000)::bigint::text trigger_ms,
        (extract(epoch from client_start_at)*1000)::bigint::text client_start_ms
      from early_bird_launch_configs where active for share
    `);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      !row ||
      typeof row.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        row.id,
      ) ||
      !["WAVE_1_EARLY_BIRD", "PUBLIC_LAUNCH"].includes(row.phase)
    )
      throw new Error("early_bird_launch_config_invalid");
    const triggerAtMs = Number(row.trigger_ms);
    const clientStartAtMs = Number(row.client_start_ms);
    if (
      !Number.isSafeInteger(triggerAtMs) ||
      !Number.isSafeInteger(clientStartAtMs)
    )
      throw new Error("early_bird_launch_config_invalid");
    // Read the clock after acquiring the lock, not before waiting for it.
    const now = await tx.execute<{ in_window: boolean }>(sql`
      select early_bird_wave_active(early_bird_current_time()) as in_window
    `);
    if (now.rows.length !== 1 || typeof now.rows[0]?.in_window !== "boolean")
      throw new Error("early_bird_launch_config_invalid");
    return {
      version: row.id,
      triggerAtMs,
      clientStartAtMs,
      phase:
        row.phase === "WAVE_1_EARLY_BIRD" && now.rows[0].in_window
          ? "WAVE_1_EARLY_BIRD"
          : "PUBLIC_LAUNCH",
    };
  }
  async lockCurrent(tx: Pick<DrizzleDb, "execute">): Promise<string | null> {
    const config = await this.lockCurrentState(tx);
    return config?.version ?? null;
  }
}
