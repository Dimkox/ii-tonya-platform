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
  /**
   * Claim rules keep a negated clause («не назначает лечение», «без спама») readable, because the
   * approved disclaimers use exactly those words. The marketing word list of REQ-EXP-001.02 has no
   * such exemption: every word form is rejected.
   */
  readonly negationExempt?: boolean;
}

type ClientCopyRulePattern = ClientCopyRule & { readonly pattern: RegExp };

const notWord = String.raw`(?![\p{L}\p{N}_])`;
const notWordBefore = String.raw`(?<![\p{L}\p{N}_])`;

const CLIENT_COPY_RULES: readonly ClientCopyRulePattern[] = [
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
      `${notWordBefore}специально\\s*для\\s*(?:вас|тебя)${notWord}`,
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

export const CLIENT_COPY_PROHIBITED_RULES: readonly ClientCopyRule[] =
  CLIENT_COPY_RULES.map(({ reasonCode, label, negationExempt }) =>
    negationExempt === undefined
      ? { reasonCode, label }
      : { reasonCode, label, negationExempt },
  );

const brandSeparator = String.raw`[\s\u00A0\u2010-\u2014-]*`;
const brandEnding = String.raw`(?:ей|ья|ь|я|и|е|ю)`;
const brandMention = new RegExp(
  `${notWordBefore}(?:ии${brandSeparator})?тон${brandEnding}${notWord}`,
  "giu",
);
const prefixedBrandCore = new RegExp(
  `${notWordBefore}ии${brandSeparator}тон${brandEnding}`,
  "giu",
);
const latinBrandMention = new RegExp(
  `${notWordBefore}(?:ii|ии)${brandSeparator}ton(?:ya|ey|ia|e|i|u)?`,
  "giu",
);
const junkSuffix = /^(?:[\p{L}\p{N}_]|-[\p{L}\p{N}])/u;
const hostOrEmailAfter = /^(?:@[^\s]+|\.[a-z]{2,})/iu;

const canonicalBrandForms = new Set<string>([
  "ии-Тоня",
  "ии-Тоне",
  "ии-Тоню",
  "ии-Тоней",
  "ии-Тони",
  "Ии-Тоня",
  "Ии-Тоне",
  "Ии-Тоню",
  "Ии-Тоней",
  "Ии-Тони",
]);

const formatNoise = /[\u00AD\u200B-\u200D\u2060\uFEFF]/gu;
const nbsp = /[\u00A0\u202F\u2007]/gu;

const normalizeClientCopy = (text: string): string =>
  text.normalize("NFKC").replace(formatNoise, "").replace(nbsp, " ");

const CLAUSE_BOUNDARY = new Set([
  ".",
  "!",
  "?",
  "\n",
  ",",
  ";",
  ":",
  "—",
  "–",
  "…",
  "(",
  ")",
  "«",
  "»",
]);

const clauseStart = (text: string, index: number): number => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (CLAUSE_BOUNDARY.has(text[cursor] ?? "")) return cursor + 1;
  }
  return 0;
};

const clauseEnd = (text: string, index: number): number => {
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (CLAUSE_BOUNDARY.has(text[cursor] ?? "")) return cursor;
  }
  return text.length;
};

const stripToken = (token: string): string =>
  token.replace(/^[«"'(]+|[»"').]+$/gu, "");

const tokensIn = (text: string): string[] =>
  text.split(/\s+/u).map(stripToken).filter((token) => token.length > 0);

const negationBefore = /^(?:не|без|никак|никогда|нельзя|нет)$/iu;
const negationAfter = /^(?:не|нет)$/iu;

const isNegatedClaim = (
  text: string,
  matchStart: number,
  matchEnd: number,
): boolean => {
  const before = tokensIn(text.slice(clauseStart(text, matchStart), matchStart));
  const after = tokensIn(text.slice(matchEnd, clauseEnd(text, matchEnd)));
  if (before.slice(-2).some((token) => negationBefore.test(token))) return true;
  return after.slice(0, 4).some((token) => negationAfter.test(token));
};

const firstViolation = (
  pattern: RegExp,
  text: string,
  negationExempt: boolean | undefined,
): boolean => {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const start = match.index;
    const end = start + (match[0] ?? "").length;
    if (!negationExempt || !isNegatedClaim(text, start, end)) return true;
    match = pattern.exec(text);
  }
  return false;
};

const isHostOrEmailContext = (
  text: string,
  start: number,
  end: number,
): boolean => {
  const before = text.slice(Math.max(0, start - 1), start);
  const after = text.slice(end);
  return /[@/]/u.test(before) || hostOrEmailAfter.test(after);
};

const hasBrandViolation = (text: string): boolean => {
  prefixedBrandCore.lastIndex = 0;
  let prefixed: RegExpExecArray | null = prefixedBrandCore.exec(text);
  while (prefixed !== null) {
    const end = prefixed.index + (prefixed[0] ?? "").length;
    if (junkSuffix.test(text.slice(end))) return true;
    prefixed = prefixedBrandCore.exec(text);
  }
  latinBrandMention.lastIndex = 0;
  let latin: RegExpExecArray | null = latinBrandMention.exec(text);
  while (latin !== null) {
    const start = latin.index;
    const end = start + (latin[0] ?? "").length;
    if (!isHostOrEmailContext(text, start, end)) return true;
    latin = latinBrandMention.exec(text);
  }
  brandMention.lastIndex = 0;
  let mention: RegExpExecArray | null = brandMention.exec(text);
  while (mention !== null) {
    if (!canonicalBrandForms.has(mention[0] ?? "")) return true;
    mention = brandMention.exec(text);
  }
  return false;
};

export const guardClientCopy = (text: string): ClientCopyGuardResult => {
  const normalized = normalizeClientCopy(text);
  if (hasBrandViolation(normalized)) {
    return { accepted: false, reasonCode: "client_copy_brand_name_variant" };
  }
  for (const rule of CLIENT_COPY_RULES) {
    if (firstViolation(rule.pattern, normalized, rule.negationExempt)) {
      return { accepted: false, reasonCode: rule.reasonCode };
    }
  }
  return { accepted: true };
};
