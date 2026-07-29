import { z } from "zod";

const MINIMUM_LEAD_TIME_MS = 24 * 60 * 60 * 1_000;
const canonicalUtcTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const timestamp = new Date(value);
    return (
      Number.isFinite(timestamp.getTime()) &&
      timestamp.toISOString() === value
    );
  });
const externalIdentifier = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value);
const providerSlotSchema = z
  .object({
    externalSlotId: externalIdentifier,
    expertExternalId: externalIdentifier,
    startsAt: canonicalUtcTimestamp,
    endsAt: canonicalUtcTimestamp,
    capacity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    observedAt: canonicalUtcTimestamp,
  })
  .strict();

export interface ProviderSlot {
  externalSlotId: string;
  expertExternalId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  observedAt: string;
}

export type PlanerkaMutationOutcome =
  | { kind: "applied"; providerOperationId: string }
  | { kind: "not_applied"; retryable: boolean; reasonCode: string }
  | {
      kind: "unknown_outcome";
      reconciliationKey: string;
      reasonCode: string;
    };

export interface PlanerkaPort {
  listSlots(window: {
    from: string;
    to: string;
  }): Promise<readonly ProviderSlot[]>;
  reserve(command: {
    idempotencyKey: string;
    externalSlotId: string;
    externalReservationId: string;
  }): Promise<PlanerkaMutationOutcome>;
  confirm(command: {
    idempotencyKey: string;
    externalReservationId: string;
  }): Promise<PlanerkaMutationOutcome>;
  cancel(command: {
    idempotencyKey: string;
    externalReservationId: string;
  }): Promise<PlanerkaMutationOutcome>;
  getReservation(
    externalReservationId: string,
  ): Promise<"reserved" | "booked" | "cancelled" | "missing">;
}

export function normalizeProviderSlots(
  slots: readonly ProviderSlot[],
  now: Date,
  maxAgeMs: number,
): readonly ProviderSlot[] {
  let nowMs: number;
  try {
    nowMs = Date.prototype.getTime.call(now);
  } catch {
    return [];
  }
  if (
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs <= 0
  ) {
    return [];
  }

  try {
    const parsed: Array<{
      slot: ProviderSlot;
      startsAtMs: number;
      endsAtMs: number;
      observedAtMs: number;
    }> = [];
    const identifierCounts = new Map<string, number>();
    for (const candidate of slots) {
      const result = providerSlotSchema.safeParse(candidate);
      if (!result.success) continue;
      const slot = result.data;
      identifierCounts.set(
        slot.externalSlotId,
        (identifierCounts.get(slot.externalSlotId) ?? 0) + 1,
      );
      parsed.push({
        slot,
        startsAtMs: Date.parse(slot.startsAt),
        endsAtMs: Date.parse(slot.endsAt),
        observedAtMs: Date.parse(slot.observedAt),
      });
    }

    const minimumStartMs = nowMs + MINIMUM_LEAD_TIME_MS;
    return parsed
      .filter(
        ({ slot, startsAtMs, endsAtMs, observedAtMs }) =>
          identifierCounts.get(slot.externalSlotId) === 1 &&
          endsAtMs > startsAtMs &&
          startsAtMs >= minimumStartMs &&
          observedAtMs <= nowMs &&
          nowMs - observedAtMs <= maxAgeMs,
      )
      .map(({ slot }) => slot)
      .sort(
        (left, right) =>
          left.startsAt.localeCompare(right.startsAt) ||
          left.externalSlotId.localeCompare(right.externalSlotId),
      );
  } catch {
    return [];
  }
}
