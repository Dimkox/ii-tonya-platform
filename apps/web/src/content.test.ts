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
    expect(landingContent.clientCta).toContain("каталог");
    expect(landingContent.clientCta).toContain("личный кабинет");
    expect(copy).toContain("тест эксперт");
    expect(copy).toContain("500 сообщений");
    expect(copy).toContain("начисление и использование купонов в V2 отключены");
    expect(copy).toContain("45 дней");
    expect(copy).toContain("24/7");
    const clientCopy = JSON.stringify([
      landingContent.about,
      landingContent.aboutProposition,
      landingContent.principles,
      landingContent.clientCta,
      ...landingContent.faq.slice(0, 8),
      ...landingContent.faq.slice(17),
    ]);
    expect(clientCopy).not.toMatch(
      /Ты просто пишешь|рассказываешь мне о себе|бесплатный доступ к диагностике|Я проведу с тобой мини-диагностику|Я подберу удобное время|Я сразу покажу его свободные слоты|Я веду историю|проводим еженедельные|Напиши мне, что именно/iu,
    );
    expect(clientCopy).toContain("Персональный диалог пока недоступен");
    expect(clientCopy).toContain("Покупка пакетов пока недоступна");
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
      .update(JSON.stringify(landingContent.faq.slice(8, 17)))
      .digest("hex");
    expect(digest).toBe(
      "048fcc00d37d55e1e5ce0b743b810c4333e92b4105fa4a848766a3bfc77b5348",
    );
  });

  it("preserves every client package amount and term while purchase is unavailable", () => {
    expect(landingContent.messagePackages).toEqual([
      ["Знакомство", "100 сообщений, без срока"],
      ["Старт", "500 сообщений, 60 дней, 4 999 ₽"],
      ["Базовый", "1000 сообщений, 60 дней, 5 999 ₽"],
      ["Глубокий", "1500 сообщений, 60 дней, 7 999 ₽"],
      ["Максимальный", "2000 сообщений, 60 дней, 10 990 ₽"],
    ]);
    expect(landingContent.faq[2][1]).toContain(
      "Покупка пакетов пока недоступна",
    );
  });

  it("keeps a truthful fail-closed contact boundary", () => {
    expect(landingContent.contact.formNotice).toContain("не отправляет данные");
    expect(landingContent.contact.formNotice).not.toMatch(/чат/iu);
    expect(landingContent.contact.formNotice).toContain("телефон или e-mail");
    expect(landingContent.contact.formNotice).toContain(
      "Не отправляйте личную историю",
    );
  });

  it("qualifies private account capabilities on enabled login", () => {
    expect(landingContent.faq[0][1]).toContain("если вход включён");
    expect(landingContent.faq[18][1]).toContain("если вход включён");
    expect(landingContent.faq[18][1]).toContain("После входа");
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
