import { isProxy } from "node:util/types";
import { z } from "zod";

const MINIMUM_LEAD_TIME_MS = 24 * 60 * 60 * 1_000;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
/** Hard fail-closed bound for one provider availability snapshot. */
export const MAX_PROVIDER_SLOT_CANDIDATES = 10_000;
const PROVIDER_SLOT_FIELDS = [
  "externalSlotId",
  "expertExternalId",
  "startsAt",
  "endsAt",
  "capacity",
  "observedAt",
] as const;
const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/u;
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
const isSafeExternalIdentifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 256 &&
  value.trim() === value &&
  !controlCharacter.test(value);
const externalIdentifier = z.string().refine(isSafeExternalIdentifier);
const providerSlotSchema = z
  .object({
    externalSlotId: externalIdentifier,
    expertExternalId: externalIdentifier,
    startsAt: canonicalUtcTimestamp,
    endsAt: canonicalUtcTimestamp,
    capacity: z.number().int().positive().max(POSTGRES_INTEGER_MAX),
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

interface InspectedCandidate {
  candidate: unknown;
  externalSlotId?: string;
  schemaEligible: boolean;
}

const inspectCandidate = (
  candidate: unknown,
): InspectedCandidate | undefined => {
  if (candidate === null || typeof candidate !== "object") {
    return { candidate, schemaEligible: false };
  }
  if (isProxy(candidate)) return undefined;

  const descriptors = new Map<
    (typeof PROVIDER_SLOT_FIELDS)[number],
    PropertyDescriptor | undefined
  >();
  for (const field of PROVIDER_SLOT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
    if (descriptor && !("value" in descriptor)) return undefined;
    descriptors.set(field, descriptor);
  }

  const externalSlotId = descriptors.get("externalSlotId")?.value as unknown;
  return {
    candidate,
    ...(isSafeExternalIdentifier(externalSlotId) ? { externalSlotId } : {}),
    schemaEligible: PROVIDER_SLOT_FIELDS.every((field) =>
      descriptors.get(field),
    ),
  };
};

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

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
    if (
      !Array.isArray(slots) ||
      isProxy(slots) ||
      slots.length > MAX_PROVIDER_SLOT_CANDIDATES
    ) {
      return [];
    }

    const inspected: InspectedCandidate[] = [];
    for (let index = 0; index < slots.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(slots, String(index));
      if (!descriptor || !("value" in descriptor)) return [];
      const inspection = inspectCandidate(descriptor.value);
      if (!inspection) return [];
      inspected.push(inspection);
    }

    const parsed: Array<{
      slot: ProviderSlot;
      startsAtMs: number;
      endsAtMs: number;
      observedAtMs: number;
    }> = [];
    const identifierCounts = new Map<string, number>();
    for (const { externalSlotId } of inspected) {
      if (!externalSlotId) continue;
      identifierCounts.set(
        externalSlotId,
        (identifierCounts.get(externalSlotId) ?? 0) + 1,
      );
    }
    for (const { candidate, schemaEligible } of inspected) {
      if (!schemaEligible) continue;
      const result = providerSlotSchema.safeParse(candidate);
      if (!result.success) continue;
      const slot = result.data;
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
          compareCodeUnits(left.startsAt, right.startsAt) ||
          compareCodeUnits(left.externalSlotId, right.externalSlotId),
      );
  } catch {
    return [];
  }
}
