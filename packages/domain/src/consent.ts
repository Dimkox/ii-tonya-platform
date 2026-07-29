export type ConsentPurpose = "client_profile" | "expert_note" | "follow_up";

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
}

export interface ExpertView {
  reservationId: string;
  startsAt: string;
  displayTimezone: string;
  clientDisplayName: string;
  expertNote?: string;
}

const granted = (purpose: ConsentPurpose, grants: readonly ConsentGrant[]): boolean => {
  const valid = grants.filter((entry) =>
    entry.purpose === purpose && Number.isFinite(entry.recordedAt.getTime()));
  const latestTimestamp = Math.max(...valid.map((entry) => entry.recordedAt.getTime()));
  const latest = valid.filter((entry) => entry.recordedAt.getTime() === latestTimestamp);
  return latest.length > 0 && latest.every((entry) => entry.granted);
};

export function buildProfilePatch(input: ProfileInput, grants: readonly ConsentGrant[]): ProfilePatch {
  if (!granted("client_profile", grants)) return { displayName: input.displayName };
  return {
    displayName: input.displayName,
    ...(input.goals ? { goals: input.goals } : {}),
    ...(input.expertNote && granted("expert_note", grants) ? { expertNote: input.expertNote } : {}),
  };
}

export function buildExpertView(input: ReservationViewInput): ExpertView {
  return {
    reservationId: input.reservationId,
    startsAt: input.startsAt,
    displayTimezone: input.displayTimezone,
    clientDisplayName: input.clientDisplayName,
    ...(input.expertNoteConsent && input.expertNote ? { expertNote: input.expertNote } : {}),
  };
}
