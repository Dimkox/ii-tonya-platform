import type {
  ExpiryDeps,
  JobResult,
} from "./reservation-expiry.js";
import type {
  LocalReservationSnapshot,
  ProviderReservationSnapshot,
  ReconciliationDeps,
  ReconciliationObservation,
} from "./reconciliation.js";
import type {
  SafetyHandoffAcknowledgement,
  SafetyHandoffDeps,
  SafetyHandoffReport,
} from "./safety-handoff.js";

interface FreeEffect {
  readonly idempotencyKey: string;
  readonly topic: string;
  readonly charge: 0;
}

interface EffectRecorder {
  topics(): string[];
  idempotencyKeys(): string[];
  allFree(): boolean;
}

function effectRecorder(effects: ReadonlyMap<string, FreeEffect>): EffectRecorder {
  return {
    topics: () => [...effects.values()].map((effect) => effect.topic),
    idempotencyKeys: () => [...effects.keys()],
    allFree: () => [...effects.values()].every((effect) => effect.charge === 0),
  };
}

export interface ReservationExpirySeed {
  readonly id: string;
  readonly status:
    | "reserved"
    | "booked"
    | "cancelled_by_client"
    | "cancelled_by_expert"
    | "expired"
    | "completed"
    | "no_show";
  readonly reservedUntil: string;
  readonly version: number;
}

export interface ExpiryFixture extends ExpiryDeps {
  readonly outbox: EffectRecorder;
  status(id: string): ReservationExpirySeed["status"];
}

export function expiryFixture(
  seed: readonly ReservationExpirySeed[],
): ExpiryFixture {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const effects = new Map<string, FreeEffect>();
  const requireRow = (id: string) => {
    const row = rows.get(id);
    if (row === undefined) throw new Error(`Unknown reservation ${id}`);
    return row;
  };
  return {
    repository: {
      async expireDueBatch({ now, batchSize }): Promise<JobResult> {
        const due = [...rows.values()]
          .filter((row) =>
            row.status === "reserved"
            && Date.parse(row.reservedUntil) <= now.getTime())
          .slice(0, batchSize);
        for (const row of due) {
          const nextVersion = row.version + 1;
          row.status = "expired";
          row.version = nextVersion;
          for (const topic of [
            "planerka.cancel",
            "client.reservation_expired",
            "expert.reservation_expired",
          ]) {
            const idempotencyKey = `${row.id}:${String(nextVersion)}:${topic}`;
            effects.set(idempotencyKey, { idempotencyKey, topic, charge: 0 });
          }
        }
        return { examined: due.length, changed: due.length, failed: 0 };
      },
    },
    outbox: effectRecorder(effects),
    status: (id) => requireRow(id).status,
  };
}

export interface ReconciliationSeed {
  readonly local: readonly LocalReservationSnapshot[];
  readonly provider: readonly ProviderReservationSnapshot[];
  readonly providerUnavailable?: boolean;
  readonly circuitFailureThreshold?: number;
}

interface TestCircuit {
  open(): void;
  isOpen(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
}

export interface ReconciliationFixture extends ReconciliationDeps {
  readonly transitions: string[];
  readonly alerts: string[];
  readonly projectionRepairs: string[];
  readonly circuit: TestCircuit;
}

export function reconciliationFixture(
  seed: ReconciliationSeed,
): ReconciliationFixture {
  const local = seed.local.map((row) => ({ ...row }));
  const provider = seed.provider.map((row) => ({ ...row }));
  const transitions: string[] = [];
  const alerts: string[] = [];
  const projectionRepairs: string[] = [];
  const threshold = seed.circuitFailureThreshold ?? 3;
  let failures = 0;
  let open = false;
  const circuit: TestCircuit = {
    open: () => { open = true; },
    isOpen: () => open,
    recordSuccess: () => { failures = 0; },
    recordFailure: () => {
      failures += 1;
      if (failures >= threshold) open = true;
    },
  };
  return {
    repository: {
      async listLocalReservations(_window, batchSize) {
        return local.slice(0, batchSize);
      },
      async recordObservation(observation: ReconciliationObservation) {
        for (const mismatch of observation.mismatches) {
          void mismatch;
          alerts.push("reservation_state_drift");
        }
        for (const repair of observation.projectionRepairs) {
          projectionRepairs.push(repair.reservationId);
          const row = local.find((candidate) => candidate.id === repair.reservationId);
          if (row !== undefined) row.projectionDelivery = "delivered";
        }
      },
      async recordProviderUnavailable() {
        alerts.push("provider_unavailable");
      },
    },
    provider: {
      async listReservations(_window, batchSize) {
        if (seed.providerUnavailable) throw new Error("provider unavailable");
        return provider.slice(0, batchSize);
      },
    },
    circuit,
    transitions,
    alerts,
    projectionRepairs,
  };
}

export interface HandoffSeed {
  readonly id: string;
  readonly status: "assigned" | "acknowledged" | "escalated" | "resolved";
  readonly ownerId: string;
  readonly acknowledgeBy: string;
  readonly acknowledgedAt: string | null;
  readonly version: number;
}

interface SwitchableCircuit {
  open(): void;
  isOpen(): boolean;
}

export interface SafetyHandoffFixture extends SafetyHandoffDeps {
  readonly planerkaCircuit: SwitchableCircuit;
  readonly intentModelCircuit: SwitchableCircuit;
  readonly outbox: EffectRecorder;
  readonly audit: { actions(): string[] };
  status(id: string): HandoffSeed["status"];
}

function switchableCircuit(): SwitchableCircuit {
  let open = false;
  return { open: () => { open = true; }, isOpen: () => open };
}

export function safetyHandoffFixture(
  seed: readonly HandoffSeed[],
): SafetyHandoffFixture {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const effects = new Map<string, FreeEffect>();
  const auditByKey = new Map<string, string>();
  const requireRow = (id: string) => {
    const row = rows.get(id);
    if (row === undefined) throw new Error(`Unknown safety handoff ${id}`);
    return row;
  };
  return {
    repository: {
      async processDueBatch({ now, batchSize }): Promise<SafetyHandoffReport> {
        const due = [...rows.values()]
          .filter((row) =>
            (row.status === "assigned" || row.status === "acknowledged")
            && Date.parse(row.acknowledgeBy) <= now.getTime())
          .slice(0, batchSize);
        let escalated = 0;
        for (const row of due) {
          if (row.status !== "assigned" || row.acknowledgedAt !== null) continue;
          const nextVersion = row.version + 1;
          row.status = "escalated";
          row.version = nextVersion;
          const topic = "safety.operator_escalation";
          const idempotencyKey = `${row.id}:${String(nextVersion)}:${topic}`;
          effects.set(idempotencyKey, { idempotencyKey, topic, charge: 0 });
          auditByKey.set(
            `${row.id}:${String(nextVersion)}:safety.handoff_sla_escalated`,
            "safety.handoff_sla_escalated",
          );
          escalated += 1;
        }
        return {
          examined: due.length,
          escalated,
          unchanged: due.length - escalated,
        };
      },
      async acknowledge(command: SafetyHandoffAcknowledgement) {
        const row = requireRow(command.handoffId);
        if (
          row.status !== "assigned"
          || row.ownerId !== command.operatorId
          || row.version !== command.expectedVersion
          || command.acknowledgedAt.getTime() > Date.parse(row.acknowledgeBy)
        ) return { kind: "conflict" } as const;
        row.status = "acknowledged";
        row.acknowledgedAt = command.acknowledgedAt.toISOString();
        row.version += 1;
        return { kind: "acknowledged", version: row.version } as const;
      },
    },
    planerkaCircuit: switchableCircuit(),
    intentModelCircuit: switchableCircuit(),
    outbox: effectRecorder(effects),
    audit: { actions: () => [...auditByKey.values()] },
    status: (id) => requireRow(id).status,
  };
}
