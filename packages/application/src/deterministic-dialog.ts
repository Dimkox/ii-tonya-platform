import type { SafetyRisk } from "@ii-tonya/domain";

import type {
  DeterministicSafetyPort,
  IntentEngine,
  IntentInput,
  IntentProposal,
  TypedSafetyPort,
} from "./ports.js";

/**
 * Menu-based client dialog without any language model.
 *
 * The production LLM provider is schema-locked off (`LLM_ENABLED`,
 * `INTENT_MODEL_ENABLED`, `LLM_PROVIDER`), so the client dialog is answered by a
 * fixed keyword menu. An optional hook can be supplied later; it is ignored
 * unless explicitly enabled, and its output still passes the existing
 * `validateIntentProposal` fence inside `createConversationService`.
 */
export interface ConversationLlmHook {
  readonly intent?: IntentEngine;
  readonly safety?: TypedSafetyPort;
}

export interface MenuDialogOptions {
  /** Off by default; there is no approved LLM provider. */
  readonly llmEnabled?: boolean;
  readonly llm?: ConversationLlmHook;
}

export const MENU_DIALOG_TEXT = {
  menu:
    "Здравствуйте! Я помогу подобрать специалиста и записаться.\n" +
    "Напишите одно из слов:\n" +
    "• «каталог» — посмотреть услуги и специалистов;\n" +
    "• «запись» — как записаться на консультацию;\n" +
    "• «данные» — как мы обращаемся с вашими данными;\n" +
    "• «оператор» — позвать человека.\n" +
    "Пожалуйста, не присылайте сюда историю болезни, документы и чужие данные.",
  booking:
    "Чтобы записаться, напишите «каталог», выберите специалиста и свободное время. " +
    "Если удобнее с помощью человека, напишите «оператор».",
  privacy:
    "Мы храним только то, что нужно для записи. Посмотреть или удалить свои данные " +
    "можно в личном кабинете, раздел «Данные». Не присылайте в чат документы и чужие данные.",
  fallback:
    "Я пока понимаю только команды меню. Напишите «меню», чтобы увидеть варианты, " +
    "или «оператор», чтобы позвать человека.",
} as const;

const normalize = (text: string): string =>
  text.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();

const includesAny = (text: string, needles: readonly string[]): boolean =>
  needles.some((needle) => text.includes(needle));

const SAFETY_RULES: readonly (readonly [SafetyRisk, readonly string[]])[] = [
  [
    "self_harm",
    [
      "суицид",
      "самоубий",
      "покончить с собой",
      "убить себя",
      "не хочу жить",
      "порезать себя",
      "повеситься",
    ],
  ],
  ["abuse", ["насили", "избивает", "бьет меня", "домогает"]],
  ["violence", ["убью", "убить его", "убить ее", "зарежу"]],
  ["urgent", ["скорая", "умираю", "срочно помогите", "sos"]],
  [
    "medical",
    ["дозировк", "какие таблетки", "какое лекарство", "поставьте диагноз"],
  ],
];

/** Fixed keyword detector; anything it flags goes to a human, never to the menu. */
export const createKeywordSafetyGuard = (): DeterministicSafetyPort => ({
  detect(text) {
    const value = normalize(text);
    for (const [risk, needles] of SAFETY_RULES) {
      if (includesAny(value, needles)) return risk;
    }
    return null;
  },
});

/**
 * Without a classifier the deterministic guard is the only safety layer; this
 * port answers "ordinary" unless an enabled hook supplies a real classifier.
 */
export const createMenuTypedSafety = (
  options: MenuDialogOptions = {},
): TypedSafetyPort => {
  const hook = options.llmEnabled === true ? options.llm?.safety : undefined;
  return {
    classify: (text) =>
      hook ? hook.classify(text) : Promise.resolve("ordinary"),
  };
};

const pickServiceCode = (
  text: string,
  allowed: readonly string[],
): string | undefined =>
  allowed.find((code) => text.split(" ").includes(code.toLowerCase()));

export const proposeMenuIntent = (input: IntentInput): IntentProposal => {
  const text = normalize(input.text);
  if (includesAny(text, ["оператор", "человек", "менеджер", "поддержк"])) {
    return { kind: "human_handoff", reasonCode: "client_requested_human" };
  }
  if (
    includesAny(text, ["каталог", "услуг", "специалист", "эксперт", "/catalog"])
  ) {
    const serviceCode = pickServiceCode(
      text,
      input.authorization.allowedServiceCodes,
    );
    return serviceCode === undefined
      ? { kind: "show_catalog" }
      : { kind: "show_catalog", serviceCode };
  }
  if (includesAny(text, ["запис", "бронь", "заброн", "консультац", "/book"])) {
    const [only, ...rest] = input.authorization.allowedExpertIds;
    return only !== undefined && rest.length === 0
      ? { kind: "start_booking", expertId: only }
      : { kind: "answer", text: MENU_DIALOG_TEXT.booking };
  }
  if (
    includesAny(text, ["данные", "приватн", "персональн", "удал", "/privacy"])
  ) {
    return { kind: "answer", text: MENU_DIALOG_TEXT.privacy };
  }
  if (
    includesAny(text, ["меню", "привет", "здравств", "начать", "помощь"]) ||
    text === "/start" ||
    text === "/help"
  ) {
    return { kind: "answer", text: MENU_DIALOG_TEXT.menu };
  }
  return { kind: "answer", text: MENU_DIALOG_TEXT.fallback };
};

export const createMenuIntentEngine = (
  options: MenuDialogOptions = {},
): IntentEngine => {
  const hook = options.llmEnabled === true ? options.llm?.intent : undefined;
  return {
    propose: (input) =>
      hook ? hook.propose(input) : Promise.resolve(proposeMenuIntent(input)),
  };
};
