import { randomUUID } from "node:crypto";

import { PostgresBookingRepository, sql, type DrizzleDb } from "@ii-tonya/db";

type Phase = "cancel_active" | "cleanup_public";
type Claim = Readonly<{
  deletionJobId: string;
  userId: string;
  phase: Phase;
  leaseToken: string;
  attemptCount: number;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const claimOne = async (db: DrizzleDb): Promise<Claim | null> =>
  db.transaction(async (tx) => {
    const candidate = (
      await tx.execute<{
        deletionJobId: string;
        userId: string;
        phase: Phase;
        attemptCount: number;
      }>(sql`
        select w.deletion_job_id as "deletionJobId",j.user_id as "userId",
          w.phase,w.attempt_count as "attemptCount"
        from client_booking_erasure_work w
        join privacy_deletion_jobs j on j.id=w.deletion_job_id
        where w.phase in ('cancel_active','cleanup_public')
          and (w.lease_until is null or w.lease_until<=clock_timestamp())
        order by w.updated_at,w.deletion_job_id
        for update of w skip locked
        limit 1
      `)
    ).rows[0];
    if (candidate === undefined) return null;
    const leaseToken = randomUUID();
    const updated = (
      await tx.execute<{ attemptCount: number }>(sql`
        update client_booking_erasure_work set
          lease_token=${leaseToken}::uuid,
          lease_until=clock_timestamp()+interval '5 minutes',
          attempt_count=attempt_count+1,
          updated_at=clock_timestamp()
        where deletion_job_id=${candidate.deletionJobId}::uuid
          and phase=${candidate.phase}
        returning attempt_count as "attemptCount"
      `)
    ).rows[0];
    if (updated === undefined) return null;
    return { ...candidate, leaseToken, attemptCount: updated.attemptCount };
  });

const releaseFailure = async (db: DrizzleDb, claim: Claim): Promise<void> => {
  await db.execute(sql`
    update client_booking_erasure_work set
      phase=case when attempt_count>=5 then 'dead_letter' else phase end,
      lease_token=null,lease_until=null,updated_at=clock_timestamp()
    where deletion_job_id=${claim.deletionJobId}::uuid
      and lease_token=${claim.leaseToken}::uuid
      and phase=${claim.phase}
  `);
};

const processCancel = async (
  db: DrizzleDb,
  bookings: PostgresBookingRepository,
  claim: Claim,
): Promise<void> => {
  const active = (
    await db.execute<{ reservationId: string }>(sql`
      select id as "reservationId" from reservations
      where user_id=${claim.userId}::uuid and status in ('reserved','booked')
      order by id
    `)
  ).rows;
  for (const reservation of active) {
    const outcome = await bookings.cancelBookingForErasure({
      userId: claim.userId,
      reservationId: reservation.reservationId,
      correlationId: `privacy-client-cancel-v1:${claim.deletionJobId}:${reservation.reservationId}`,
    });
    if (outcome.kind === "not_found" || outcome.kind === "conflict") {
      throw new Error("client_booking_erasure_cancel_conflict");
    }
  }
  const remaining = (
    await db.execute<{ exists: boolean }>(sql`
      select exists (
        select 1 from reservations
        where user_id=${claim.userId}::uuid and status in ('reserved','booked')
      ) as exists
    `)
  ).rows[0]?.exists;
  if (remaining !== false)
    throw new Error("client_booking_erasure_active_remains");
  const advanced = await db.execute(sql`
    update client_booking_erasure_work set phase='cleanup_public',
      lease_token=null,lease_until=null,attempt_count=0,updated_at=clock_timestamp()
    where deletion_job_id=${claim.deletionJobId}::uuid
      and lease_token=${claim.leaseToken}::uuid and phase='cancel_active'
    returning 1
  `);
  if (advanced.rows.length !== 1) {
    throw new Error("client_booking_erasure_lease_lost");
  }
};

const processCleanup = async (db: DrizzleDb, claim: Claim): Promise<void> => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level serializable`);
    const fenced = (
      await tx.execute<{ userId: string }>(sql`
        select j.user_id as "userId"
        from client_booking_erasure_work w
        join privacy_deletion_jobs j on j.id=w.deletion_job_id
        where w.deletion_job_id=${claim.deletionJobId}::uuid
          and w.lease_token=${claim.leaseToken}::uuid
          and w.phase='cleanup_public'
        for update of w
      `)
    ).rows[0];
    if (fenced === undefined || fenced.userId !== claim.userId) {
      throw new Error("client_booking_erasure_lease_lost");
    }
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`client:${claim.userId}`},0)
      )
    `);
    const active = await tx.execute(sql`
      select id from reservations
      where user_id=${claim.userId}::uuid and status in ('reserved','booked')
      order by id for update
    `);
    if (active.rows.length !== 0) {
      throw new Error("client_booking_erasure_active_remains");
    }
    await tx.execute(sql`
      delete from client_booking_receipts where user_id=${claim.userId}::uuid
    `);
    await tx.execute(sql`
      delete from client_catalog_requests where user_id=${claim.userId}::uuid
    `);
    const completed = await tx.execute(sql`
      update client_booking_erasure_work set phase='complete',
        lease_token=null,lease_until=null,updated_at=clock_timestamp()
      where deletion_job_id=${claim.deletionJobId}::uuid
        and lease_token=${claim.leaseToken}::uuid
        and phase='cleanup_public'
      returning 1
    `);
    if (completed.rows.length !== 1) {
      throw new Error("client_booking_erasure_lease_lost");
    }
  });
};

export async function runClientBookingErasureBatch(input: {
  db: DrizzleDb;
  bookings?: PostgresBookingRepository;
  limit: number;
}): Promise<{ examined: number; completed: number; failed: number }> {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  ) {
    throw new Error("client_booking_erasure_batch_invalid");
  }
  const bookings = input.bookings ?? new PostgresBookingRepository(input.db);
  let examined = 0;
  let completed = 0;
  let failed = 0;
  for (; examined < input.limit; examined += 1) {
    const claim = await claimOne(input.db);
    if (claim === null) break;
    if (
      !UUID_PATTERN.test(claim.deletionJobId) ||
      !UUID_PATTERN.test(claim.userId)
    ) {
      await releaseFailure(input.db, claim);
      failed += 1;
      continue;
    }
    try {
      if (claim.phase === "cancel_active") {
        await processCancel(input.db, bookings, claim);
      } else {
        await processCleanup(input.db, claim);
        completed += 1;
      }
    } catch {
      await releaseFailure(input.db, claim);
      failed += 1;
    }
  }
  return { examined, completed, failed };
}
