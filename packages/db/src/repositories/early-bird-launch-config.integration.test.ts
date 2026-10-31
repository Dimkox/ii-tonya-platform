import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { EarlyBirdLaunchConfigAuthority } from "./early-bird-launch-config.js";
import { startTestPostgres } from "../testkit/postgres.js";

it("starts fail-closed, preserves immutable versions and exposes one locked generation", async () => {
  const fixture = await startTestPostgres();
  try {
    await fixture.migrate();
    const initial = await fixture.db.execute<{
      phase: string;
      promo_deadline_days: number;
    }>(
      sql`select phase,promo_deadline_days from early_bird_launch_configs where active`,
    );
    expect(initial.rows).toMatchObject([
      { phase: "PUBLIC_LAUNCH", promo_deadline_days: 10 },
    ]);
    const lockedPublic = await fixture.db.transaction((tx) =>
      new EarlyBirdLaunchConfigAuthority().lockCurrentState(tx),
    );
    expect(lockedPublic?.phase).toBe("PUBLIC_LAUNCH");
    await expect(
      fixture.db.execute(
        sql`update early_bird_launch_configs set client_start_at = '2027-01-12' where active`,
      ),
    ).rejects.toThrow();
    await expect(
      fixture.db.execute(
        sql`delete from early_bird_launch_configs where active`,
      ),
    ).rejects.toThrow();
    await expect(
      fixture.db.execute(
        sql`insert into early_bird_launch_configs (phase, enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at,active) values ('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03',true)`,
      ),
    ).rejects.toThrow();
    await fixture.db.execute(
      sql`create or replace function early_bird_current_time() returns timestamptz language sql volatile as $$ select '2026-11-15 12:00:00+03'::timestamptz $$`,
    );
    await fixture.db.transaction(async (tx) => {
      await tx.execute(
        sql`update early_bird_launch_configs set active = false where active`,
      );
      await tx.execute(
        sql`insert into early_bird_launch_configs (phase, enrollment_start_at,client_start_at,promo_deadline_days,final_call_trigger_at) values ('WAVE_1_EARLY_BIRD','2026-11-01 00:00:00+03','2027-01-11 00:00:00+03',10,'2026-12-28 10:00:00+03')`,
      );
      const state = await new EarlyBirdLaunchConfigAuthority().lockCurrentState(
        tx,
      );
      expect(state).toMatchObject({
        phase: "WAVE_1_EARLY_BIRD",
        triggerAtMs: 1798441200000,
        clientStartAtMs: 1799614800000,
      });
      expect(state?.version).not.toBe(lockedPublic?.version);
    });
  } finally {
    await fixture.stop();
  }
}, 120_000);
