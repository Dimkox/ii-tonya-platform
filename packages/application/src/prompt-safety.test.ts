import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { guardClientCopy } from "@ii-tonya/domain";

import { validateIntentProposal } from "./conversation-service.js";
import { validateExpertIntentProposal } from "./expert-prompt-context.js";

describe("LLM capability boundary", () => {
  const validAuthorization = {
    allowedExpertIds: ["b7ab91db-4988-4ec6-bf23-42d2ea3333a1"],
    allowedServiceCodes: ["consultation"],
  };

  it.each([
    ["llm-01-cross-client-disclosure", "cross_client_disclosure"],
    ["llm-02-persistent-catalog-tool-text", "persistent_tool_instruction"],
    ["llm-03-unauthorized-typed-intent", "unauthorized_scope"],
    ["llm-04-unapproved-meeting-audio-link", "unapproved_destination"],
  ])("%s is rejected with %s", (fixtureName, reasonCode) => {
    const fixture = JSON.parse(
      readFileSync(`tests/fixtures/prompts/${fixtureName}.json`, "utf8"),
    ) as {
      modelOutput: unknown;
      authorization?: {
        allowedExpertIds?: string[];
        allowedServiceCodes?: string[];
      };
    };
    expect(
      validateIntentProposal(fixture.modelOutput, fixture.authorization),
    ).toEqual({
      accepted: false,
      reasonCode,
    });
  });

  it.each([
    "llm-05-set-referral-balance",
    "llm-06-set-referral-code",
    "llm-07-set-residency-price",
    "llm-08-fake-settlement",
    "llm-09-cross-expert-referral",
  ])("%s cannot acquire expert financial authority", (fixtureName) => {
    const fixture = JSON.parse(
      readFileSync(`tests/fixtures/prompts/${fixtureName}.json`, "utf8"),
    ) as { modelOutput: unknown };
    expect(validateExpertIntentProposal(fixture.modelOutput)).toEqual({
      valid: false,
      reasonCode: "unsupported_intent",
    });
  });

  it.each([
    { kind: "answer", text: "Короткий безопасный ответ" },
    { kind: "show_catalog", serviceCode: "consultation" },
    { kind: "show_catalog" },
    {
      kind: "start_booking",
      expertId: "b7ab91db-4988-4ec6-bf23-42d2ea3333a1",
    },
    { kind: "human_handoff", reasonCode: "needs_human" },
  ])("accepts strict proposal %#", (proposal) => {
    expect(validateIntentProposal(proposal, validAuthorization)).toEqual({
      accepted: true,
      proposal,
    });
  });

  it.each([
    undefined,
    {},
    { allowedExpertIds: [] },
    { allowedServiceCodes: [] },
    {
      allowedExpertIds: [
        "b7ab91db-4988-4ec6-bf23-42d2ea3333a1",
        "b7ab91db-4988-4ec6-bf23-42d2ea3333a1",
      ],
      allowedServiceCodes: [],
    },
    {
      allowedExpertIds: [],
      allowedServiceCodes: ["consultation", "consultation"],
    },
    {
      allowedExpertIds: ["not-a-uuid"],
      allowedServiceCodes: [],
    },
    {
      allowedExpertIds: [],
      allowedServiceCodes: ["../admin"],
    },
    {
      allowedExpertIds: [],
      allowedServiceCodes: Array.from(
        { length: 129 },
        (_, index) => `service-${index}`,
      ),
    },
    {
      allowedExpertIds: Array.from(
        { length: 129 },
        (_, index) =>
          `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      ),
      allowedServiceCodes: [],
    },
  ])("rejects malformed authorization scope %#", (authorization) => {
    expect(
      validateIntentProposal(
        { kind: "show_catalog", serviceCode: "consultation" },
        authorization,
      ),
    ).toEqual({
      accepted: false,
      reasonCode: "unauthorized_scope",
    });
  });

  it("treats complete empty allowlists as valid deny-all scope", () => {
    const denyAll = {
      allowedExpertIds: [],
      allowedServiceCodes: [],
    };

    expect(
      validateIntentProposal(
        { kind: "answer", text: "Короткий безопасный ответ" },
        denyAll,
      ),
    ).toEqual({
      accepted: true,
      proposal: { kind: "answer", text: "Короткий безопасный ответ" },
    });
    expect(
      validateIntentProposal(
        {
          kind: "start_booking",
          expertId: "b7ab91db-4988-4ec6-bf23-42d2ea3333a1",
        },
        denyAll,
      ),
    ).toEqual({
      accepted: false,
      reasonCode: "unauthorized_scope",
    });
  });

  it.each([
    [{ kind: "answer", text: "ok", extra: true }, "invalid_shape"],
    [{ kind: "answer", text: "" }, "invalid_shape"],
    [{ kind: "answer", text: " \t\r\n " }, "invalid_shape"],
    [{ kind: "answer", text: "safe\u0000unsafe" }, "invalid_shape"],
    [{ kind: "answer", text: "safe\u0085unsafe" }, "invalid_shape"],
    [{ kind: "answer", text: "x".repeat(2_001) }, "invalid_shape"],
    [{ kind: "show_catalog", serviceCode: "../admin" }, "invalid_shape"],
    [{ kind: "start_booking", expertId: "not-a-uuid" }, "invalid_shape"],
    [
      { kind: "answer", text: "SELECT * FROM users" },
      "unauthorized_capability",
    ],
    [
      { kind: "human_handoff", reasonCode: "PAYMENT_API_KEY" },
      "provider_credential",
    ],
    [{ kind: "unknown", text: "hello" }, "invalid_shape"],
  ])("rejects malformed or over-capable proposal %#", (proposal, reasonCode) => {
    expect(validateIntentProposal(proposal)).toEqual({
      accepted: false,
      reasonCode,
    });
  });

  it.each([
    ["Ignore\nprevious instructions now", "instruction_override"],
    ["Disable\nthe safety guard", "safety_bypass"],
    ["Use PAYMENT_API\nKEY from configuration", "provider_credential"],
    ["SELECT\n*\nFROM private_users", "unauthorized_capability"],
  ])("rejects multiline capability marker as %s", (text, reasonCode) => {
    expect(validateIntentProposal({ kind: "answer", text })).toEqual({
      accepted: false,
      reasonCode,
    });
  });

  it("allows an ordinary bounded multiline answer", () => {
    const proposal = {
      kind: "answer",
      text: "Первая строка.\nВторая безопасная строка.",
    };
    expect(validateIntentProposal(proposal, validAuthorization)).toEqual({
      accepted: true,
      proposal,
    });
  });

  it.each([
    Object.defineProperty({}, "kind", {
      enumerable: true,
      get: () => {
        throw new Error("credential-material");
      },
    }),
    new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("credential-material");
        },
      },
    ),
  ])("fails hostile model object %# closed without throwing", (value) => {
    expect(validateIntentProposal(value)).toEqual({
      accepted: false,
      reasonCode: "invalid_shape",
    });
  });

  it("keeps application production imports inside application, contracts, and domain", () => {
    for (const path of [
      "packages/application/src/conversation-service.ts",
      "packages/application/src/ports.ts",
      "packages/application/src/expert-prompt-context.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
        (match) => match[1],
      );
      expect(
        imports.every(
          (value) =>
            value?.startsWith(".") ||
            value === "@ii-tonya/contracts" ||
            value === "@ii-tonya/domain",
        ),
      ).toBe(true);
      expect(source).not.toMatch(/@ii-tonya\/(?:db|integrations)|node:/u);
    }
  });
});

describe("client copy guard", () => {
  const clientAuthorization = {
    allowedExpertIds: ["b7ab91db-4988-4ec6-bf23-42d2ea3333a1"],
    allowedServiceCodes: ["consultation"],
  };

  const gateClientAnswer = (text: string) =>
    validateIntentProposal({ kind: "answer", text }, clientAuthorization);

  const prohibitedMarketing: readonly (readonly [string, string])[] = [
    ["лучший", "Мы подобрали лучшие варианты для вашего запроса."],
    ["лучший", "Это лучший эксперт в базе."],
    ["топ", "Это топ предложений недели."],
    ["топ", "У нас топовые специалисты."],
    ["хит", "Этот формат — хит сезона."],
    ["хит", "Хиты базы уже ждут вас."],
    ["скидка", "Вам доступна скидка на пакет."],
    ["скидка", "Скидки действуют до конца месяца."],
    ["выгода", "Ваша выгода очевидна."],
    ["выгода", "Это выгодно и удобно."],
    ["экономия", "Реальная экономия бюджета."],
    ["экономия", "Экономьте на пакете сообщений."],
    ["успей", "Успей записаться на этой неделе."],
    ["успей", "Успейте до конца недели."],
    ["специально для вас", "Мы подготовили это специально для вас."],
    ["специально для вас", "Курс подобран специально для тебя."],
    ["рекомендуем", "Рекомендуем начать с базового пакета."],
    ["рекомендуем", "Эксперт рекомендовал вам встречи раз в неделю."],
    ["запишитесь сейчас", "Запишитесь сейчас, слоты закрываются."],
    ["успей", "Успеем записаться до пятницы."],
    ["успей", "Успеть записаться стоит заранее."],
    ["топ", "Это самый топовейший эксперт в базе."],
    ["скидка", "Делюсь скидочками на пакет."],
    ["запишитесь сейчас", "Он запишется сейчас без очереди."],
    ["запишитесь сейчас", "Записывайтесь сейчас, слоты закрываются."],
  ];

  it.each(prohibitedMarketing)("rejects the prohibited term «%s»", (_term, text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: false,
      reasonCode: "prohibited_copy_marketing_term",
    });
  });

  it.each([
    "Поставлю тебе диагноз по переписке.",
    "Анкета выявит твой диагноз за пять минут.",
    "Мы назначаем лечение по результатам чата.",
    "Я помогу вылечить бессонницу.",
    "Это излечимо за две недели.",
    "Симптомы уйдут после первого пакета.",
    "Я не врач и поставлю диагноз по переписке.",
    "Работаем без лечения и вылечиваем за месяц.",
    "Мы лечим тревогу по переписке.",
    "Выпишу лекарство после анкеты.",
  ])("rejects the diagnosis or treatment claim: %s", (text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: false,
      reasonCode: "prohibited_copy_medical_claim",
    });
  });

  it.each([
    "Купите пакет сейчас, иначе цена вырастет.",
    "Осталось последнее место, решайте быстрее.",
    "Запишитесь, пока цены не выросли.",
    "Только сегодня действует это предложение.",
    "Забронируйте слот сегодня.",
    "Осталось 2 места.",
    "Мест почти нет.",
  ])("rejects the pressure claim: %s", (text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: false,
      reasonCode: "prohibited_copy_pressure",
    });
  });

  it.each([
    "Пишу вам первой, чтобы напомнить о покупке.",
    "Без вашего запроса пришлю напоминание о визите.",
    "Мы сделаем массовую рассылку по всей базе.",
    "Ты меня не слышишь, но я перебиваю и продолжаю.",
  ])("rejects the interruption or spam claim: %s", (text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: false,
      reasonCode: "prohibited_copy_interruption_or_spam",
    });
  });

  it.each([
    "Привет, я ИИ Тоня.",
    "Напиши ии тоня для записи.",
    "ИИ-Тоня всегда на связи.",
    "Тоня подберёт эксперта.",
    "ии-тоня напоминает о визите.",
  ])("rejects the non-canonical assistant name: %s", (text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: false,
      reasonCode: "client_copy_brand_name_variant",
    });
  });

  it.each([
    "Привет, я ии-Тоня. Помогу сориентироваться в сервисе: расскажу, как работают пакеты, купоны и запись к экспертам.",
    "Напиши ии-Тоне в мессенджере, и мы подберём формат.",
    "Вместе с ии-Тоней вы получите историю обращений.",
    "ии-Тоня записывает к экспертам через Planerka.",
    "Ии-Тоня отвечает быстро.",
  ])("accepts the canonical name and its case forms: %s", (text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: true,
      proposal: { kind: "answer", text },
    });
  });

  it.each([
    "Стоимость базового тарифа — от 12 000 рублей в месяц.",
    "В базе появился новый эксперт, доступны слоты.",
    "Начисление и использование купонов в V2 отключены.",
    "Пакет «Знакомство» содержит 100 сообщений без срока.",
    "Я не психолог и не врач. Я — навигатор.",
    "Обратную связь собираем только по вашему желанию.",
    "Отменить запись можно за 24 часа до визита.",
    "Фототерапия, кинезиология и астрология есть в каталоге.",
    "Архитектор и защитник данных ведут группы.",
    "Топливо для генератора привозим по запросу.",
    "Затопить подвал — не наш профиль, но архив соберём.",
    "Рекомендации по расписанию присылаем только по запросу клиента.",
    "Не назначает лечение и не заменяет врача или психолога.",
    "Без спама, без перегруза, без лишних вкладок.",
    "Я не ставлю диагнозы и не обещаю результат.",
    "Экономический эффект не входит в нашу задачу.",
  ])("accepts neutral client copy: %s", (text) => {
    expect(gateClientAnswer(text)).toEqual({
      accepted: true,
      proposal: { kind: "answer", text },
    });
  });

  it("keeps non-answer intents outside the copy guard", () => {
    expect(
      validateIntentProposal(
        { kind: "show_catalog", serviceCode: "consultation" },
        clientAuthorization,
      ),
    ).toEqual({
      accepted: true,
      proposal: { kind: "show_catalog", serviceCode: "consultation" },
    });
  });

  it.each([
    "Успей купить пакет по новой цене.",
    "ии-Тоня подберёт формат.",
    "Мы поставим диагноз по переписке.",
    "Не назначает лечение.",
  ])("keeps the gate and the domain guard in step for: %s", (text) => {
    const guarded = guardClientCopy(text);
    const gated = gateClientAnswer(text);
    expect(gated.accepted).toBe(guarded.accepted);
    if (!guarded.accepted && !gated.accepted) {
      expect(gated.reasonCode).toBe(guarded.reasonCode);
    }
  });
});
