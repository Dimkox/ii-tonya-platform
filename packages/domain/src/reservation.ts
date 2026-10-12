export type ReservationStatus =
  | "reserved"
  | "booked"
  | "cancelled_by_client"
  | "cancelled_by_expert"
  | "expired"
  | "completed"
  | "no_show";
export type ReservationAction =
  | "expert_confirm"
  | "client_cancel"
  | "expert_cancel"
  | "expire"
  | "complete"
  | "mark_no_show";

const transitions: Partial<
  Record<
    ReservationStatus,
    Partial<Record<ReservationAction, ReservationStatus>>
  >
> = {
  reserved: {
    expert_confirm: "reserved",
    client_cancel: "cancelled_by_client",
    expert_cancel: "cancelled_by_expert",
    expire: "expired",
  },
  booked: {
    client_cancel: "cancelled_by_client",
    expert_cancel: "cancelled_by_expert",
    complete: "completed",
    mark_no_show: "no_show",
  },
};

export function computeReservedUntil(
  createdAt: Date,
  slotStartsAt: Date,
  confirmationBufferMs: number,
): Date {
  const createdAtMs = createdAt.getTime();
  const slotStartsAtMs = slotStartsAt.getTime();
  if (
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(slotStartsAtMs) ||
    !Number.isFinite(confirmationBufferMs) ||
    confirmationBufferMs < 0
  ) {
    throw new Error("Invalid reservation deadline inputs");
  }
  const deadlineMs = Math.min(
    createdAtMs + 72 * 60 * 60 * 1_000,
    slotStartsAtMs - confirmationBufferMs,
  );
  if (!Number.isFinite(deadlineMs))
    throw new Error("Invalid reservation deadline inputs");
  const deadline = new Date(deadlineMs);
  if (Number.isNaN(deadline.getTime()))
    throw new Error("Invalid reservation deadline inputs");
  if (deadline.getTime() <= createdAtMs)
    throw new Error("Reservation deadline has already passed");
  return deadline;
}

export function transitionReservation(
  status: ReservationStatus,
  action: ReservationAction,
): ReservationStatus {
  const next = transitions[status]?.[action];
  if (!next) throw new Error("Invalid reservation transition");
  return next;
}
