export interface LifecycleSchedulerRepository {
  scheduleReservationLifecycle?(reservationId: string): Promise<number>;
  cancelReservationLifecycle?(
    reservationId: string,
    reason: string,
  ): Promise<number>;
  processDueLifecycleBatch(command: {
    now: Date;
    batchSize: number;
  }): Promise<unknown>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REASON_RE = /^[a-z][a-z0-9_]{0,63}$/u;

function validateReservationId(id: string): void {
  if (!UUID_RE.test(id) || id !== id.toLowerCase())
    throw new Error("Invalid reservation UUID");
}

export async function scheduleReservationLifecycle(
  repository: LifecycleSchedulerRepository,
  reservationId: string,
): Promise<number> {
  validateReservationId(reservationId);
  if (!repository.scheduleReservationLifecycle)
    throw new Error("Lifecycle scheduling unavailable");
  return repository.scheduleReservationLifecycle(reservationId);
}

export async function cancelReservationLifecycle(
  repository: LifecycleSchedulerRepository,
  reservationId: string,
  reason: string,
): Promise<number> {
  validateReservationId(reservationId);
  if (!REASON_RE.test(reason))
    throw new Error("Invalid lifecycle cancellation reason");
  if (!repository.cancelReservationLifecycle)
    throw new Error("Lifecycle cancellation unavailable");
  return repository.cancelReservationLifecycle(reservationId, reason);
}

export function validateLifecycleBatch(command: {
  now: Date;
  batchSize: number;
}): void {
  if (!(command.now instanceof Date) || Number.isNaN(command.now.getTime()))
    throw new Error("Invalid lifecycle batch time");
  if (
    !Number.isSafeInteger(command.batchSize) ||
    command.batchSize < 1 ||
    command.batchSize > 500
  )
    throw new Error("Invalid lifecycle batch size");
}

export async function processDueLifecycleBatch(
  repository: LifecycleSchedulerRepository,
  command: { now: Date; batchSize: number },
): Promise<unknown> {
  validateLifecycleBatch(command);
  return repository.processDueLifecycleBatch(command);
}
