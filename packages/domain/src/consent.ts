export type ConsentPurpose =
  "client_profile" | "expert_note" | "expert_handoff" | "follow_up";

export interface ReservationViewInput {
  reservationId: string;
  startsAt: string;
  displayTimezone: string;
  clientDisplayName: string;
  expertNote?: string;
  expertNoteConsent: boolean;
  // DEC-PLT-004 §3: the transfer to the expert is its own grant, separate from `expert_note`.
  // Required + fail-closed: only an explicit `true` reveals the name/note; anything else collapses
  // to the minimal handoff (pseudonym, no request note).
  expertHandoffConsent: boolean;
}

export interface ExpertView {
  reservationId: string;
  startsAt: string;
  displayTimezone: string;
  clientDisplayName: string;
  expertNote?: string;
}

export function buildExpertView(input: ReservationViewInput): ExpertView {
  if (input.expertHandoffConsent !== true) {
    return {
      reservationId: input.reservationId,
      startsAt: input.startsAt,
      displayTimezone: input.displayTimezone,
      clientDisplayName: "Клиент",
    };
  }
  return {
    reservationId: input.reservationId,
    startsAt: input.startsAt,
    displayTimezone: input.displayTimezone,
    clientDisplayName: input.clientDisplayName,
    ...(input.expertNoteConsent && input.expertNote
      ? { expertNote: input.expertNote }
      : {}),
  };
}
