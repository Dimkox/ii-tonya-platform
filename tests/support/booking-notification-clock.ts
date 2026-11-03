import { sql } from "drizzle-orm";
import type { DrizzleDb } from "../../packages/db/src/client.js";

/** Fixture observation and command share one explicit PG millisecond instant.
 * Production still compares original timestamps without future/stale tolerance. */
export async function observeBookingNotificationSlot(
  database: Pick<DrizzleDb, "execute">,
  slotId: string,
): Promise<Date> {
  const row = (
    await database.execute<{ now: string }>(sql`
      with anchor as materialized (
        select date_trunc('milliseconds',clock_timestamp()) as at
      )
      update slots s set observed_at=anchor.at from anchor
      where s.id=${slotId}::uuid
      returning to_char(anchor.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now
    `)
  ).rows[0];
  if (!row) throw Error("booking_notification_fixture_slot_missing");
  return new Date(row.now);
}
