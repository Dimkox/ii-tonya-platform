export type SafetyRisk = "self_harm" | "violence" | "medical" | "abuse" | "urgent" | "uncertain";
export type AgeBand = "minor" | "adult" | "unknown";
export type SafetyContactChannel = "phone" | "sms" | "url";

export interface SafetyContact {
  id: string;
  label: string;
  channel: SafetyContactChannel;
  value: string;
  countryCode: string;
  regionCode: string | null;
  ageBands: readonly AgeBand[];
  riskTypes: readonly SafetyRisk[];
  sourceUrl: string;
  owner: string;
  verifiedAt: Date;
  validUntil: Date;
}

const e164Phone = /^\+[1-9][0-9]{7,14}$/u;
const httpsUrl = /^https:\/\/[A-Za-z0-9.-]+(?:\/[^\s@]*)?$/u;

export const isActionableSafetyContact = (
  contact: Pick<SafetyContact, "channel" | "value">,
): boolean => {
  if (contact.channel === "phone" || contact.channel === "sms") {
    return e164Phone.test(contact.value);
  }
  return contact.channel === "url" && httpsUrl.test(contact.value);
};

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

const normalizeCode = (code: string | null): string | null =>
  code === null ? null : code.trim().toUpperCase();

export async function evaluateSafety(
  input: SafetyInput,
  guard: DeterministicSafetyGuard,
  classifier: SafetyClassifier,
  directory: SafetyDirectory,
): Promise<SafetyDecision> {
  const countryCode = normalizeCode(input.countryCode);
  const regionCode = normalizeCode(input.regionCode);
  const selectContacts = (risk: SafetyRisk): SafetyContact[] => directory.list().filter((contact) =>
    normalizeCode(contact.countryCode) === countryCode
    && (contact.regionCode === null || normalizeCode(contact.regionCode) === regionCode)
    && contact.ageBands.includes(input.ageBand)
    && contact.riskTypes.includes(risk)
    && contact.verifiedAt.getTime() <= input.now.getTime()
    && contact.validUntil.getTime() >= input.now.getTime()
    && contact.sourceUrl.startsWith("https://")
    && contact.owner.length > 0
    && isActionableSafetyContact(contact));

  try {
    const level = guard.detect(input.text) ?? await classifier.classify(input.text);
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

export const CLIENT_ASSISTANT_NAME = "ии-Тоня";

export type ClientCopyRejectionReason =
  | "client_copy_brand_name_variant"
  | "prohibited_copy_marketing_term"
  | "prohibited_copy_medical_claim"
  | "prohibited_copy_pressure"
  | "prohibited_copy_interruption_or_spam";

export type ClientCopyGuardResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reasonCode: ClientCopyRejectionReason };

export interface ClientCopyRule {
  readonly reasonCode: ClientCopyRejectionReason;
  readonly label: string;
  readonly pattern: RegExp;
  /**
   * Claim rules keep a negated clause («не назначает лечение», «без спама») readable, because the
   * approved disclaimers use exactly those words. The marketing word list of REQ-EXP-001.02 has no
   * such exemption: every word form is rejected.
   */
  readonly negationExempt?: boolean;
}

const notWord = String.raw`(?![\p{L}\p{N}_])`;
const notWordBefore = String.raw`(?<![\p{L}\p{N}_])`;

export const CLIENT_COPY_PROHIBITED_RULES: readonly ClientCopyRule[] = [
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "лучший",
    pattern: new RegExp(`${notWordBefore}лучш[а-яё]{0,4}${notWord}`, "giu"),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "топ",
    pattern: new RegExp(
      `${notWordBefore}топ(?:ова[яё]|ов[а-яё]{1,3}|ы|а|у|ом|ов|ам|ах)?${notWord}`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "хит",
    pattern: new RegExp(
      `${notWordBefore}хит(?:ова[яё]|ов[а-яё]{1,3}|ы|а|у|ом|ов|ам|ах)?${notWord}`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "скидка",
    pattern: new RegExp(`${notWordBefore}скидк[а-яё]{0,4}${notWord}`, "giu"),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "выгода",
    pattern: new RegExp(`${notWordBefore}выгод[а-яё]{0,5}${notWord}`, "giu"),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "экономия",
    pattern: new RegExp(`${notWordBefore}эконом[а-яё]{1,5}${notWord}`, "giu"),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "успей",
    pattern: new RegExp(`${notWordBefore}успей[а-яё]{0,3}${notWord}`, "giu"),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "специально для вас",
    pattern: new RegExp(
      `${notWordBefore}специально\\s+для\\s+(?:вас|тебя)${notWord}`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "рекомендуем",
    pattern: new RegExp(
      `${notWordBefore}(?:рекоменду[а-яё]{0,4}|рекомендова[а-яё]{0,3})${notWord}`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_marketing_term",
    label: "запишитесь сейчас",
    pattern: new RegExp(
      `${notWordBefore}(?:запишит[е]?сь|запишись)\\s+сейчас`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_medical_claim",
    label: "diagnosis",
    negationExempt: true,
    pattern: new RegExp(`${notWordBefore}диагно[а-яё]{1,4}${notWord}`, "giu"),
  },
  {
    reasonCode: "prohibited_copy_medical_claim",
    label: "treatment",
    negationExempt: true,
    pattern: new RegExp(
      `${notWordBefore}(?:вылеч|излеч|исцел|выздоров|лечени|препарат|симптом)[а-яё]{0,6}${notWord}`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_pressure",
    label: "urgency",
    negationExempt: true,
    pattern: new RegExp(
      `${notWordBefore}(?:купите|оформите|запишит[е]?сь|решай[а-яё]{0,3}|бер[её]те|бронир[у]?йте)[^.!?\\n]{0,32}?(?:сейчас|сегодня|быстрее|немедленно|пока[^.!?\n]{0,12}?не\\s+(?:вырос|подорож|законч|ист[ёе]к|прошл)|иначе)`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_pressure",
    label: "scarcity",
    negationExempt: true,
    pattern: new RegExp(
      `${notWordBefore}(?:осталось\\s+послед\\p{L}*|мест\\s+осталось|последн\\p{L}*\\s+(?:мест|слот)\\p{L}*|только\\s+(?:сегодня|сейчас)|цена\\s+(?:вырастет|подорожа\\p{L}*)|подорожа\\p{L}*|давлени[а-яё]{0,4})`,
      "giu",
    ),
  },
  {
    reasonCode: "prohibited_copy_interruption_or_spam",
    label: "broadcast or interruption",
    negationExempt: true,
    pattern: new RegExp(
      `${notWordBefore}(?:перебива\\p{L}*|прерв[а-яё]{0,4}\\s+(?:вас|тебя)|без\\s+(?:вашего|твоего|ваше|наше)\\s+запроса|пиш\\p{L}{0,3}\\s+(?:вам|тебе|тебя)\\s+(?:перв|сам)\\p{L}*|рассыл[а-яё]{0,5}|(?:массово|массов\\p{L}*)\\s+(?:отправ\\p{L}*|рассыл\\p{L}*|шл\\p{L}*)|(?:шл|отправ)\\p{L}*\\s+спам|спам\\p{L}*\\s+(?:сообщени|письм|рассыл))`,
      "giu",
    ),
  },
];

const brandMention = new RegExp(
  `${notWordBefore}(?:[Ии]{2}[\\s\\u00A0\\u2011\\u2010\\u2012\\u2013\\u2014-]?)?[Тт]он(?:ей|я|и|е|ю)${notWord}`,
  "gu",
);

const canonicalBrandForms = new Set<string>([
  "ии-Тоня",
  "ии-Тоне",
  "ии-Тоню",
  "ии-Тоней",
  "ии-Тони",
]);

const clauseBoundary = /[.!?\n,;:—]/u;

const isNegatedClause = (text: string, index: number): boolean => {
  let start = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (clauseBoundary.test(text.slice(cursor, cursor + 1))) {
      start = cursor + 1;
      break;
    }
  }
  return /(?:^|[\s«"])(?:не|без|никак|никогда|нельзя|запрет\w*)(?:\s|$)/iu.test(
    text.slice(start, index),
  );
};

const firstViolation = (
  pattern: RegExp,
  text: string,
  negationExempt: boolean | undefined,
): boolean => {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    if (!negationExempt || !isNegatedClause(text, match.index)) return true;
    match = pattern.exec(text);
  }
  return false;
};

export const guardClientCopy = (text: string): ClientCopyGuardResult => {
  brandMention.lastIndex = 0;
  let mention: RegExpExecArray | null = brandMention.exec(text);
  while (mention !== null) {
    if (!canonicalBrandForms.has(mention[0] ?? "")) {
      return { accepted: false, reasonCode: "client_copy_brand_name_variant" };
    }
    mention = brandMention.exec(text);
  }

  for (const rule of CLIENT_COPY_PROHIBITED_RULES) {
    if (firstViolation(rule.pattern, text, rule.negationExempt)) {
      return { accepted: false, reasonCode: rule.reasonCode };
    }
  }
  return { accepted: true };
};
