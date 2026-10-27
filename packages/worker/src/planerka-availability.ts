import {
  PlanerkaClientError,
  planerkaSlotsSchema,
  type PlanerkaClient,
} from "@ii-tonya/integrations";
import type {
  PlanerkaAvailabilityClaim,
  PlanerkaAvailableInterval,
  PlanerkaAvailabilityDiagnostic,
  PostgresPlanerkaAvailabilityRepository,
} from "@ii-tonya/db";
import { PlanerkaAvailabilityBusyError } from "@ii-tonya/db";

export interface PlanerkaAvailabilityDependencies {
  repository: Pick<
    PostgresPlanerkaAvailabilityRepository,
    "claim" | "publish" | "defer"
  >;
  client: Pick<PlanerkaClient, "getProfile" | "listEventTypes" | "listSlots">;
  accountId: number;
  admitRequest(accountId: number): Promise<boolean>;
  sleep?(milliseconds: number): Promise<void>;
}
class AvailabilityRejection extends Error {
  constructor(readonly code: PlanerkaAvailabilityDiagnostic) {
    super(code);
  }
}
function normalize(
  claim: PlanerkaAvailabilityClaim,
  raw: unknown,
): PlanerkaAvailableInterval[] {
  const parsed = planerkaSlotsSchema.safeParse(raw);
  if (!parsed.success) throw new AvailabilityRejection("invalid_response");
  const start = Date.parse(claim.windowStart),
    end = Date.parse(claim.windowEnd);
  const result = new Map<string, PlanerkaAvailableInterval>();
  for (const [date, slots] of Object.entries(parsed.data)) {
    const day = Date.parse(`${date}T00:00:00.000Z`);
    if (
      !Number.isFinite(day) ||
      new Date(day).toISOString().slice(0, 10) !== date ||
      day < start ||
      day > end
    )
      throw new AvailabilityRejection("invalid_response");
    for (const slot of slots) {
      const starts = Date.parse(slot.start),
        ends =
          slot.end == null
            ? starts + claim.durationMinutes * 60000
            : Date.parse(slot.end);
      if (
        new Date(starts).toISOString().slice(0, 10) !== date ||
        ends - starts !== claim.durationMinutes * 60000
      )
        throw new AvailabilityRejection("invalid_response");
      const value = {
        startsAt: new Date(starts).toISOString(),
        endsAt: new Date(ends).toISOString(),
      };
      if (day === end || ends > end) continue;
      const previous = result.get(value.startsAt);
      if (previous && previous.endsAt !== value.endsAt)
        throw new AvailabilityRejection("invalid_response");
      result.set(value.startsAt, value);
    }
  }
  if (result.size > 4096) throw new AvailabilityRejection("invalid_response");
  return [...result.values()].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

/** One service, three admitted GETs, then a fenced atomic DB publication. */
export async function runPlanerkaAvailabilityOnce(
  deps: PlanerkaAvailabilityDependencies,
): Promise<{
  processed: number;
  published: number;
  reason?: PlanerkaAvailabilityDiagnostic | "stale_claim";
}> {
  let processed = 0;
  try {
    const claim = await deps.repository.claim(deps.accountId);
    if (!claim) return { processed: 0, published: 0 };
    processed = 1;
    const sleep =
      deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const admit = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await deps.admitRequest(deps.accountId)) return;
        if (attempt < 2) await sleep(2100);
      }
      throw new AvailabilityRejection("account_rate_limit");
    };
    let slots: PlanerkaAvailableInterval[];
    try {
      if (claim.accountId !== deps.accountId)
        throw new AvailabilityRejection("mapping_invalid");
      await admit();
      const profile = await deps.client.getProfile();
      if (profile.id !== claim.accountId || profile.timeZone !== claim.timeZone)
        throw new AvailabilityRejection("mapping_invalid");
      await admit();
      const matches = (await deps.client.listEventTypes()).filter(
        (t) => t.id === claim.eventTypeId,
      );
      const type = matches[0];
      if (
        matches.length !== 1 ||
        !type ||
        type.ownerId !== claim.accountId ||
        type.length !== claim.durationMinutes ||
        type.lengthInMinutes !== claim.durationMinutes ||
        type.price !== 0 ||
        type.hidden ||
        type.requiresConfirmation ||
        type.schedulingType ||
        (type.seatsPerTimeSlot ?? 1) !== 1
      )
        throw new AvailabilityRejection("mapping_invalid");
      await admit();
      slots = normalize(
        claim,
        await deps.client.listSlots({
          eventTypeId: claim.eventTypeId,
          start: new Date(claim.windowStart).toISOString().slice(0, 10),
          end: new Date(claim.windowEnd).toISOString().slice(0, 10),
          timeZone: "UTC",
          duration: claim.durationMinutes,
          format: "range",
        }),
      );
    } catch (error) {
      const code =
        error instanceof AvailabilityRejection
          ? error.code
          : error instanceof PlanerkaClientError
            ? error.code === "invalid_response"
              ? "invalid_response"
              : "provider_unavailable"
            : undefined;
      if (!code) throw error;
      await deps.repository.defer(claim, code);
      return { processed: 1, published: 0, reason: code };
    }
    try {
      return (await deps.repository.publish(claim, slots))
        ? { processed: 1, published: slots.length }
        : { processed: 1, published: 0, reason: "stale_claim" };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "planerka_availability_slot_conflict"
      )
        throw error;
      await deps.repository.defer(claim, "slot_conflict");
      return { processed: 1, published: 0, reason: "slot_conflict" };
    }
  } catch (error) {
    if (error instanceof PlanerkaAvailabilityBusyError)
      return { processed, published: 0, reason: "database_busy" };
    throw error;
  }
}
