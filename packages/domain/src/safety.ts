export type SafetyRisk = "self_harm" | "violence" | "medical" | "abuse" | "urgent" | "uncertain";
export type AgeBand = "minor" | "adult" | "unknown";

export interface SafetyContact {
  id: string;
  label: string;
  channel: string;
  countryCode: string;
  regionCode: string | null;
  ageBands: readonly AgeBand[];
  riskTypes: readonly SafetyRisk[];
  sourceUrl: string;
  owner: string;
  verifiedAt: Date;
  validUntil: Date;
}

export interface DeterministicSafetyGuard {
  detect(text: string): SafetyRisk | null;
}

export interface SafetyClassifier {
  classify(text: string): Promise<"ordinary" | SafetyRisk>;
}

export interface SafetyDirectory {
  list(): readonly SafetyContact[];
}

export interface SafetyInput {
  text: string;
  countryCode: string;
  regionCode: string | null;
  ageBand: AgeBand;
  ledgerBalance: number;
  now: Date;
}

export type SafetyDecision =
  | { kind: "ordinary"; charge: -1; contacts: [] }
  | {
    kind: "human_handoff";
    charge: 0;
    reason: SafetyRisk | "classifier_unavailable";
    directoryState: "fresh" | "no_fresh_contact" | "fresh_fallback" | "fallback_required";
    contacts: SafetyContact[];
  };

export async function evaluateSafety(
  input: SafetyInput,
  guard: DeterministicSafetyGuard,
  classifier: SafetyClassifier,
  directory: SafetyDirectory,
): Promise<SafetyDecision> {
  const deterministicRisk = guard.detect(input.text);
  const selectContacts = (risk: SafetyRisk): SafetyContact[] => directory.list().filter((contact) =>
    contact.countryCode === input.countryCode
    && (contact.regionCode === null || contact.regionCode === input.regionCode)
    && contact.ageBands.includes(input.ageBand)
    && contact.riskTypes.includes(risk)
    && contact.verifiedAt.getTime() <= input.now.getTime()
    && contact.validUntil.getTime() >= input.now.getTime()
    && contact.sourceUrl.startsWith("https://")
    && contact.owner.length > 0);

  try {
    const level = deterministicRisk ?? await classifier.classify(input.text);
    if (level === "ordinary") return { kind: "ordinary", charge: -1, contacts: [] };
    const contacts = selectContacts(level);
    return {
      kind: "human_handoff",
      charge: 0,
      reason: level,
      directoryState: contacts.length > 0 ? "fresh" : "no_fresh_contact",
      contacts,
    };
  } catch {
    const contacts = selectContacts("uncertain");
    return {
      kind: "human_handoff",
      charge: 0,
      reason: "classifier_unavailable",
      directoryState: contacts.length > 0 ? "fresh_fallback" : "fallback_required",
      contacts,
    };
  }
}

export interface HandoffState {
  status: "opened" | "assigned" | "acknowledged" | "escalated" | "resolved";
  ownerId: string | null;
  openedAt: Date;
  acknowledgeBy: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  version: number;
}

export type HandoffAction =
  | { kind: "assign"; ownerId: string }
  | { kind: "acknowledge" }
  | { kind: "check_ack_sla" }
  | { kind: "resolve" };

export function transitionHandoff(state: HandoffState, action: HandoffAction, now: Date): HandoffState {
  if (action.kind === "assign" && state.status === "opened" && action.ownerId.length > 0) {
    return { ...state, status: "assigned", ownerId: action.ownerId, version: state.version + 1 };
  }
  if (
    action.kind === "check_ack_sla"
    && state.status === "assigned"
    && state.acknowledgedAt === null
    && now.getTime() >= state.acknowledgeBy.getTime()
  ) {
    return { ...state, status: "escalated", version: state.version + 1 };
  }
  if (action.kind === "acknowledge" && state.status === "assigned") {
    return { ...state, status: "acknowledged", acknowledgedAt: now, version: state.version + 1 };
  }
  if (action.kind === "resolve" && (state.status === "acknowledged" || state.status === "escalated")) {
    return { ...state, status: "resolved", resolvedAt: now, version: state.version + 1 };
  }
  throw new Error("Invalid handoff transition");
}
