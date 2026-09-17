export type ConsentPurpose =
  "client_profile" | "expert_note" | "expert_handoff" | "follow_up";

export interface ConsentGrant {
  purpose: ConsentPurpose;
  granted: boolean;
  recordedAt: Date;
}

export interface ProfileInput {
  displayName: string;
  goals?: string;
  expertNote?: string;
}

export interface ProfilePatch {
  displayName: string;
  goals?: string;
  expertNote?: string;
}

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

const granted = (
  purpose: ConsentPurpose,
  grants: readonly ConsentGrant[],
): boolean => {
  const entries = grants.filter((entry) => entry.purpose === purpose);
  if (entries.some((entry) => !Number.isFinite(entry.recordedAt.getTime())))
    return false;
  const latestTimestamp = Math.max(
    ...entries.map((entry) => entry.recordedAt.getTime()),
  );
  const latest = entries.filter(
    (entry) => entry.recordedAt.getTime() === latestTimestamp,
  );
  return latest.length > 0 && latest.every((entry) => entry.granted);
};

export function buildProfilePatch(
  input: ProfileInput,
  grants: readonly ConsentGrant[],
): ProfilePatch {
  if (!granted("client_profile", grants))
    return { displayName: input.displayName };
  return {
    displayName: input.displayName,
    ...(input.goals ? { goals: input.goals } : {}),
    ...(input.expertNote && granted("expert_note", grants)
      ? { expertNote: input.expertNote }
      : {}),
  };
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
