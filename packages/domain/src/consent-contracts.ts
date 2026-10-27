const CONSENT_PURPOSES = [
  "client_profile",
  "client_messaging",
  "expert_note",
  "expert_handoff",
  "follow_up",
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const consentPurposeSchema = {
  parse(value: unknown): ConsentPurpose {
    if (
      typeof value !== "string" ||
      !(CONSENT_PURPOSES as readonly string[]).includes(value)
    ) {
      throw new Error("consent_purpose_unknown");
    }
    return value as ConsentPurpose;
  },
};

export type ConsentScopeRequest = {
  purpose: ConsentPurpose;
  requestedCategory: "ordinary_profile" | "special_health" | "third_party";
};

export type DialogueConsentState = {
  messaging: boolean;
  profile: boolean;
  expertNote: boolean;
  expertHandoff: boolean;
  followUp: boolean;
};

export function isConsentScopeAllowed(input: ConsentScopeRequest): boolean {
  if (input.requestedCategory !== "ordinary_profile") return false;
  return (
    input.purpose === "client_profile" || input.purpose === "client_messaging"
  );
}

export function deriveDialogueReadiness(state: DialogueConsentState): boolean {
  return (
    state.messaging === true &&
    state.profile === true &&
    state.expertNote === true &&
    state.expertHandoff === true &&
    state.followUp === true
  );
}
