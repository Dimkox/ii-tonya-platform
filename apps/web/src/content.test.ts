import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { landingContent } from "./content.js";

describe("landing content", () => {
  it("keeps the approved identity and complete public structure", () => {
    expect(landingContent.brand).toBe("ии-Тоня");
    expect(landingContent.hero.title).toBe("Привет, я ии-Тоня 👋");
    expect(landingContent.clientCategories).toHaveLength(7);
    expect(landingContent.messagePackages).toHaveLength(5);
    expect(landingContent.tariffs.map(({ code }) => code)).toEqual([
      "base",
      "exclusive",
      "event",
    ]);
    expect(landingContent.faq).toHaveLength(20);
    expect(landingContent.operator.ogrnip).toBe("326680000031840");
  });

  it("contains the approved client and expert offer", () => {
    const copy = JSON.stringify(landingContent);
    expect(copy).toContain("тест клиент");
    expect(copy).toContain("тест эксперт");
    expect(copy).toContain("500 сообщений");
    expect(copy).toContain("начисление и использование купонов в V2 отключены");
    expect(copy).toContain("45 дней");
    expect(copy).toContain("24/7");
    expect(landingContent.about).toEqual([
      "Привет! Я ии-Тоня — твой персональный помощник в мире саморазвития.",
      "Я не психолог и не врач. Я — навигатор. Я помогаю тебе найти того специалиста или мероприятие, которые подходят именно тебе: по запросу, по бюджету, по локации, по душе.",
      "Ты просто пишешь мне в мессенджере — я задаю вопросы, разбираюсь в твоей ситуации и подбираю подходящие варианты из моей базы. А ещё я записываю к экспертам, напоминаю о визитах и собираю обратную связь.",
      "Моя миссия — чтобы ты не тонул в рекламном шуме, а получал только то, что тебе действительно нужно. Без спама, без перегруза, без лишних вкладок.",
      "Я работаю 24/7 и всегда на связи. Ты можешь написать мне ночью — я отвечу.",
    ]);
    expect(landingContent.expertPromise).toHaveLength(4);
    expect(landingContent.expertSteps[2]?.[1]).toContain("бронирует слот");
    expect(landingContent.tariffFactors).toEqual([
      "Вашей ниши и среднего чека на услугу.",
      "Города, в котором вы работаете.",
      "Формата работы (очно / онлайн / смешанный).",
    ]);
  });

  it("keeps the exact supplied FAQ in order", () => {
    expect(landingContent.faq.map(([question]) => question)).toEqual([
      "Что такое ии-Тоня?",
      "Кто может пользоваться сервисом?",
      "Сколько это стоит для клиента?",
      "А что, если я не знаю, что мне нужно?",
      "Как я могу записаться к эксперту?",
      "Что такое купоны?",
      "Как работает реферальная программа для клиентов?",
      "Могу ли я привести друга в сервис?",
      "Как я могу стать экспертом в базе?",
      "Сколько стоит размещение для эксперта?",
      "Есть ли разовый платёж для экспертов?",
      "Что будет с моей карточкой, если я уйду из проекта?",
      "Как я получу клиентов как эксперт?",
      "Мне нужно платить за каждого клиента?",
      "Почему плата фиксированная, а не за клиента?",
      "Как быстро я получу клиентов?",
      "Что делать, если я не умею вести соцсети?",
      "Могу ли я записаться к конкретному эксперту, если уже знаю его?",
      "Как я могу отслеживать свой прогресс?",
      "Что, если мне не понравился эксперт?",
    ]);
    const digest = createHash("sha256")
      .update(JSON.stringify(landingContent.faq))
      .digest("hex");
    expect(digest).toBe(
      "87529ea3ba9e16ff39b1ddb4e4bbaf206f6bbb4b707c6dc6989d35805166597c",
    );
  });

  it("keeps a truthful fail-closed contact boundary", () => {
    expect(landingContent.contact.formNotice).toContain("не отправляет данные");
  });

  it("publishes the supplied expert tariff model", () => {
    expect(landingContent.tariffs.map(({ price }) => price)).toEqual([
      "от 12 000 рублей в месяц",
      "от 20 000 рублей в месяц",
      "10% / 15% от выручки мероприятия",
    ]);
    expect(landingContent.tariffs[0].description).toContain(
      "неограниченное количество позиций",
    );
    expect(landingContent.tariffs[1].description).toContain(
      "Клиентам с высоким бюджетом",
    );
    expect(landingContent.tariffs[0].setup).toBe(
      "Разовый платёж: 3 000 рублей за включение в базу.",
    );
    expect(landingContent.eventPayment).toHaveLength(3);
    expect(landingContent.operator.schedule).toContain("круглосуточно");
    expect(landingContent.operator.schedule).toContain("без выходных");
  });
});
