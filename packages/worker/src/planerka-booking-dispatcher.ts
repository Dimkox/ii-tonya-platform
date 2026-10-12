import {
  PlanerkaClientError,
  type PlanerkaClient,
  type PlanerkaBooking,
} from "@ii-tonya/integrations";
import type { PostgresPlanerkaBookingRepository } from "@ii-tonya/db";

export interface PlanerkaBookingDependencies {
  repository: PostgresPlanerkaBookingRepository;
  client: PlanerkaClient;
  accountId: number;
  createEnabled: boolean;
}

/** Call before enabling the production runner; no mutations or catalogue seeding. */
export async function preflightPlanerkaBooking(
  deps: PlanerkaBookingDependencies,
): Promise<void> {
  const admission = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await deps.repository.admitRequest(deps.accountId)) return;
      await new Promise((resolve) => setTimeout(resolve, 2100));
    }
    throw new Error("planerka_preflight_rate_limited");
  };
  await admission();
  const profile = await deps.client.getProfile();
  if (profile.id !== deps.accountId)
    throw new Error("planerka_account_mismatch");
  if (!deps.createEnabled) return;
  const mappings = await deps.repository.mappings(deps.accountId);
  if (!mappings.length) throw new Error("planerka_mappings_unavailable");
  await admission();
  const types = await deps.client.listEventTypes();
  for (const mapping of mappings) {
    const type = types.find((t) => t.id === mapping.eventTypeId);
    if (
      !type ||
      type.ownerId !== profile.id ||
      type.requiresConfirmation ||
      type.hidden ||
      type.schedulingType ||
      (type.seatsPerTimeSlot ?? 1) !== 1 ||
      type.price !== 0 ||
      type.length !== mapping.durationMinutes ||
      type.lengthInMinutes !== mapping.durationMinutes ||
      profile.timeZone !== mapping.timeZone
    )
      throw new Error("planerka_mapping_invalid");
  }
}

/** One bounded operation per cycle. Recovery runs even when creation is disabled. */
export async function runPlanerkaBookingOnce(
  deps: PlanerkaBookingDependencies,
): Promise<{ processed: number }> {
  const { repository, client } = deps;
  const op = await repository.claim(deps.accountId, deps.createEnabled);
  if (!op) return { processed: 0 };
  if (op.state === "unknown" && !op.providerUid) {
    // The provider offers no trustworthy create correlation. Never guess by time/name.
    await repository.needsOperator(op);
    return { processed: 1 };
  }
  if (!(await repository.admitRequest(deps.accountId))) {
    await repository.defer(op, "account_rate_limit");
    return { processed: 0 };
  }
  let received: PlanerkaBooking | undefined;
  try {
    if (op.state === "pending") {
      if (!(await repository.admitSend(op))) return { processed: 0 };
      received = await client.createBooking(op.request);
      await repository.complete(op, received);
    } else if (op.state === "cancel_pending") {
      if (!op.providerUid || !(await repository.admitSend(op, true)))
        return { processed: 0 };
      const booking = await client.cancelBooking(op.providerUid);
      if (booking.uid !== op.providerUid || booking.status !== "cancelled")
        throw new Error("planerka_cancel_unverified");
      await repository.cancelled(op);
    } else if (op.state === "cancel_unknown") {
      const result = await client.getBooking(op.providerUid!);
      // A missing record is not proof of cancellation.
      if (
        result.kind === "found" &&
        result.booking.uid === op.providerUid &&
        result.booking.status === "cancelled"
      )
        await repository.cancelled(op);
      else if (
        result.kind === "found" &&
        result.booking.uid === op.providerUid &&
        result.booking.status === "accepted"
      )
        await repository.retryCancellation(op);
      else await repository.needsOperator(op);
    } else if (op.state === "unknown" && op.providerUid) {
      const result = await client.getBooking(op.providerUid);
      if (result.kind === "found")
        await repository.complete(op, result.booking);
      else await repository.needsOperator(op);
    }
  } catch (error) {
    if (
      op.state === "pending" &&
      error instanceof PlanerkaClientError &&
      [
        "invalid_input",
        "access_denied",
        "conflict",
        "rate_limited",
        "not_found",
        "rejected",
      ].includes(error.code)
    ) {
      await repository.reject(op);
    } else if (op.state === "cancel_unknown" || op.state === "unknown") {
      await repository.needsOperator(op);
    } else {
      await repository.unknown(op);
      // A database failure must not discard an already returned bound UID.
      // This stale-lease call records evidence only; a later GET reconciles it.
      if (received) await repository.complete(op, received);
    }
  }
  return { processed: 1 };
}
