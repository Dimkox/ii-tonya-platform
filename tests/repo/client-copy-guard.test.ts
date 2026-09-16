import { describe, expect, it } from "vitest";

import { landingContent } from "../../apps/web/src/content.js";
import { renderLanding } from "../../apps/web/src/landing-view.js";
import { renderLegalPage } from "../../apps/web/src/legal-view.js";
import { guardClientCopy } from "../../packages/domain/src/index.js";

const publicCopyStrings = (
  value: unknown,
  path = "landingContent",
): { readonly path: string; readonly text: string }[] => {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      publicCopyStrings(item, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) =>
      publicCopyStrings(nested, `${path}.${key}`),
    );
  }
  return [];
};

describe("public copy obeys the client copy guard", () => {
  const strings = publicCopyStrings(landingContent);

  it("walks the whole landing document", () => {
    expect(strings.length).toBeGreaterThan(120);
  });

  it("rejects nothing that the guard would reject in a client answer", () => {
    const violations = strings.flatMap(({ path, text }) => {
      const result: ReturnType<typeof guardClientCopy> = guardClientCopy(text);
      return result.accepted ? [] : [`${path} → ${result.reasonCode}`];
    });

    expect(violations).toEqual([]);
  });

  it("is not vacuous: the same guard rejects a banned rewrite", () => {
    expect(
      guardClientCopy("Я подбираю лучшие варианты из моей базы."),
    ).toEqual({ accepted: false, reasonCode: "prohibited_copy_marketing_term" });
    expect(
      guardClientCopy("ии-Тоня рекомендует вас клиентам под их запросы."),
    ).toEqual({ accepted: false, reasonCode: "prohibited_copy_marketing_term" });
    expect(guardClientCopy("Привет, я ИИ Тоня.")).toEqual({
      accepted: false,
      reasonCode: "client_copy_brand_name_variant",
    });
  });

  it("renders the canonical brand spelling in public HTML", () => {
    const pages = [
      renderLanding({ expertChatUrl: new URL("https://t.me/ii_tonya_bot") }),
      renderLegalPage("privacy"),
    ];
    for (const html of pages) {
      expect(html).toContain("<span>ии-</span>Тоня");
      expect(html).not.toContain("<span>ии</span>Тоня");
      const visible = html.replace(/<[^>]+>/gu, "");
      expect(visible).toContain("ии-Тоня");
      expect(visible).not.toContain("ииТоня");
    }
  });
});

describe("client copy guard semantics", () => {
  it.each([
    "Диагнозы не ставим.",
    "Диагноз я не ставлю.",
    "Лечением не занимаюсь.",
    "Рассылок не делаем.",
    "Перебиваний не допускаю.",
    "Напоминания без вашего запроса не присылаю.",
    "Давления с моей стороны нет.",
    "Ии-Тоня отвечает быстро.",
  ])("accepts the inverted disclaimer or sentence-start name: %s", (text) => {
    expect(guardClientCopy(text)).toEqual({ accepted: true });
  });

  it.each([
    [
      "Я не врач и поставлю диагноз по переписке.",
      "prohibited_copy_medical_claim",
    ],
    [
      "Работаем без лечения и вылечиваем за месяц.",
      "prohibited_copy_medical_claim",
    ],
    [
      "Мы не звоним и пишем вам первыми без вашего ведома.",
      "prohibited_copy_interruption_or_spam",
    ],
    [
      "Мы не продаём и купите сейчас у нас.",
      "prohibited_copy_pressure",
    ],
    ["ИИ-ТОНЯ помогает.", "client_copy_brand_name_variant"],
    ["ии-Тоня-про помогает.", "client_copy_brand_name_variant"],
    ["ии-tonya помогает.", "client_copy_brand_name_variant"],
    ["ии-Тонь рядом.", "client_copy_brand_name_variant"],
  ])("still rejects a real claim after a nearby negation: %s", (text, reasonCode) => {
    expect(guardClientCopy(text)).toEqual({ accepted: false, reasonCode });
  });

  it("treats soft hyphens and zero-width spaces as invisible", () => {
    expect(guardClientCopy("лу\u00ADчшие варианты")).toEqual({
      accepted: false,
      reasonCode: "prohibited_copy_marketing_term",
    });
    expect(guardClientCopy("специально\u200Bдля вас")).toEqual({
      accepted: false,
      reasonCode: "prohibited_copy_marketing_term",
    });
  });
});
