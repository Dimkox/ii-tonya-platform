export type LocalReservationStatus =
  | "reserved"
  | "booked"
  | "cancelled_by_client"
  | "cancelled_by_expert"
  | "expired"
  | "completed"
  | "no_show";
export type ProviderReservationStatus = "reserved" | "booked" | "cancelled" | "missing";
export type ProjectionDeliveryStatus = "pending" | "delivered";

export interface LocalReservationSnapshot {
  readonly id: string;
  readonly externalId: string;
  readonly status: LocalReservationStatus;
  readonly projectionDelivery?: ProjectionDeliveryStatus;
}
export interface ProviderReservationSnapshot {
  readonly externalId: string;
  readonly status: ProviderReservationStatus;
  readonly projectionDelivery?: ProjectionDeliveryStatus;
}

export interface ReconciliationWindow {
  readonly from: string;
  readonly to: string;
  readonly batchSize?: number;
}

export interface ReservationMismatch {
  readonly reservationId: string;
  readonly local: LocalReservationStatus;
  readonly provider: ProviderReservationStatus;
}

export interface ProjectionDeliveryRepair {
  readonly reservationId: string;
  readonly delivery: "delivered";
}

export interface ReconciliationObservation {
  readonly window: { readonly from: string; readonly to: string };
  readonly mismatches: readonly ReservationMismatch[];
  readonly projectionRepairs: readonly ProjectionDeliveryRepair[];
}

export interface ReconciliationRepository {
  listLocalReservations(
    window: { readonly from: string; readonly to: string },
    batchSize: number,
  ): Promise<readonly LocalReservationSnapshot[]>;
  /**
   * Atomically records drift/alerts and repairs only projection delivery state.
   * Implementations must never transition authoritative reservation state.
   */
  recordObservation(observation: ReconciliationObservation): Promise<void>;
  recordProviderUnavailable(window: {
    readonly from: string;
    readonly to: string;
  }): Promise<void>;
}

export interface ReservationProviderReader {
  listReservations(
    window: { readonly from: string; readonly to: string },
    batchSize: number,
  ): Promise<readonly ProviderReservationSnapshot[]>;
}

export interface ReconciliationCircuit {
  isOpen(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
}

export interface ReconciliationDeps {
  readonly repository: ReconciliationRepository;
  readonly provider: ReservationProviderReader;
  readonly circuit: ReconciliationCircuit;
}

export interface ReconciliationReport {
  readonly examined: number;
  readonly matched: number;
  readonly mismatches: readonly ReservationMismatch[];
  readonly projectionRepairs: number;
  readonly provider: "available" | "provider_unavailable";
}

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1_000;

const statusesMatch = (
  local: LocalReservationStatus,
  provider: ProviderReservationStatus,
): boolean =>
  local === provider
  || (
    (local === "cancelled_by_client" || local === "cancelled_by_expert")
    && provider === "cancelled"
  );

function parseWindow(window: ReconciliationWindow): {
  readonly range: { readonly from: string; readonly to: string };
  readonly batchSize: number;
} {
  const from = new Date(window.from);
  const to = new Date(window.to);
  const batchSize = window.batchSize ?? DEFAULT_BATCH_SIZE;
  if (
    !Number.isFinite(from.getTime())
    || !Number.isFinite(to.getTime())
    || from.toISOString() !== window.from
    || to.toISOString() !== window.to
    || from >= to
    || !Number.isSafeInteger(batchSize)
    || batchSize < 1
    || batchSize > MAX_BATCH_SIZE
  ) {
    throw new Error("Invalid reconciliation window");
  }
  return { range: { from: window.from, to: window.to }, batchSize };
}

function uniqueProviderRows(
  rows: readonly ProviderReservationSnapshot[],
): ReadonlyMap<string, ProviderReservationSnapshot> | null {
  const byId = new Map<string, ProviderReservationSnapshot>();
  for (const row of rows) {
    if (row.externalId.trim().length === 0 || byId.has(row.externalId)) return null;
    byId.set(row.externalId, row);
  }
  return byId;
}

export async function reconcileProviderReservations(
  deps: ReconciliationDeps,
  window: ReconciliationWindow,
): Promise<ReconciliationReport> {
  const { range, batchSize } = parseWindow(window);
  const local = await deps.repository.listLocalReservations(range, batchSize);
  let providerRows: readonly ProviderReservationSnapshot[];
  try {
    if (deps.circuit.isOpen()) throw new Error("Provider circuit is open");
    providerRows = await deps.provider.listReservations(range, batchSize);
  } catch {
    deps.circuit.recordFailure();
    await deps.repository.recordProviderUnavailable(range);
    return {
      examined: local.length,
      matched: 0,
      mismatches: [],
      projectionRepairs: 0,
      provider: "provider_unavailable",
    };
  }

  const providerById = uniqueProviderRows(providerRows);
  const localExternalIds = new Set(local.map((row) => row.externalId));
  if (
    providerById === null
    || localExternalIds.size !== local.length
    || local.some((row) => !providerById.has(row.externalId))
  ) {
    deps.circuit.recordFailure();
    await deps.repository.recordProviderUnavailable(range);
    return {
      examined: local.length,
      matched: 0,
      mismatches: [],
      projectionRepairs: 0,
      provider: "provider_unavailable",
    };
  }
  deps.circuit.recordSuccess();

  const mismatches: ReservationMismatch[] = [];
  const projectionRepairs: ProjectionDeliveryRepair[] = [];
  let matched = 0;
  for (const reservation of local) {
    const provider = providerById.get(reservation.externalId);
    if (provider === undefined) continue;
    if (statusesMatch(reservation.status, provider.status)) matched += 1;
    else {
      mismatches.push({
        reservationId: reservation.id,
        local: reservation.status,
        provider: provider.status,
      });
    }
    if (
      reservation.projectionDelivery === "pending"
      && provider.projectionDelivery === "delivered"
    ) {
      projectionRepairs.push({ reservationId: reservation.id, delivery: "delivered" });
    }
  }

  await deps.repository.recordObservation({
    window: range,
    mismatches,
    projectionRepairs,
  });
  return {
    examined: local.length,
    matched,
    mismatches,
    projectionRepairs: projectionRepairs.length,
    provider: "available",
  };
}
