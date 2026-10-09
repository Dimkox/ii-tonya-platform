import { expect, it } from "vitest";
import { renderCatalogPage, renderCatalogResults } from "./catalog-view.js";
import { renderLanding } from "./landing-view.js";
import { readPublicConfig } from "./config.js";
import {
  renderAccountPage,
  renderConsentPage,
  renderMyDataPage,
} from "./consent-view.js";

const items = [
  { displayName: "Alpha", serviceCode: "career", language: "ru" },
  { displayName: "Beta", serviceCode: "career", language: "en" },
  { displayName: "Gamma", serviceCode: "coaching", language: "en" },
];
it("shows six clearly fictional demo cards without booking or payment authority", () => {
  const html = renderCatalogPage();
  const demo = html.match(
    /<section[^>]*data-demo-catalog[\s\S]*?<\/section>/u,
  )?.[0];
  expect(demo).toBeDefined();
  expect(demo).toContain("Вымышленные данные");
  expect(demo?.match(/data-demo-card/gu)).toHaveLength(6);
  expect(demo?.match(/Демо · вымышленный профиль/gu)).toHaveLength(6);
  expect(demo?.match(/Запись и оплата недоступны/gu)).toHaveLength(6);
  expect(demo).not.toMatch(
    /<a\b|<button\b|<form\b|data-catalog-item|https?:|₽/iu,
  );
  expect(html).toContain("data-catalog-results");
});
it("offers two labelled selects, loading status, and no personal input or login requirement", () => {
  const html = renderCatalogPage();
  expect(html).toContain(
    "Каталог можно смотреть без входа. Личный запрос здесь вводить не нужно.",
  );
  expect(html).toContain("Загружаем каталог…");
  expect(html.match(/<select /gu)).toHaveLength(2);
  expect(html).toContain('for="catalog-service"');
  expect(html).toContain('for="catalog-language"');
  expect(html).toContain('role="status"');
  expect(html).toContain(
    "Показаны первые 20 опубликованных услуг или меньше. Фильтры работают только с загруженными услугами.",
  );
  expect(html.match(/<main\b/gu)).toHaveLength(1);
  expect(html).toContain('aria-labelledby="catalog-heading"');
  expect(html).not.toMatch(/<input|<textarea|<script|data-login/iu);
});
it("filters locally by exact service and language; clearing restores all items", () => {
  const html = renderCatalogResults(items, {
    serviceCode: "career",
    language: "en",
  });
  expect(html).toContain("Beta");
  expect(html).not.toMatch(/Alpha|Gamma/u);
  expect(
    renderCatalogResults(items, { serviceCode: "", language: "ru" }),
  ).toContain("Alpha");
  expect(renderCatalogResults(items)).toContain("Gamma");
  expect(renderCatalogResults(items).match(/data-catalog-item/gu)).toHaveLength(
    3,
  );
});
it("distinguishes genuinely empty inventory from filters with no matches", () => {
  expect(renderCatalogResults([])).toContain(
    "В каталоге пока нет опубликованных услуг.",
  );
  const html = renderCatalogResults(items, {
    serviceCode: "coaching",
    language: "ru",
  });
  expect(html).toContain(
    "Среди загруженных услуг нет совпадений по выбранным фильтрам. Попробуй изменить или сбросить фильтры.",
  );
  expect(html).not.toContain("нет опубликованных");
});
it("escapes every public field and offers no fabricated booking, price or availability", () => {
  const html = renderCatalogResults([
    {
      displayName: '<img src=x onerror="alert(1)">',
      serviceCode: "<script>&",
      language: "<svg>'",
    },
  ]);
  expect(html).toContain("&lt;img");
  expect(html).toContain("&lt;script&gt;&amp;");
  expect(html).toContain("&lt;svg&gt;&#39;");
  expect(html).not.toMatch(/<img|<script|<svg|<button|<a |₽|записаться/iu);
});
it("links the catalog from landing and each shared cabinet page", () => {
  for (const html of [
    renderLanding(readPublicConfig({})),
    renderAccountPage(),
    renderConsentPage(),
    renderMyDataPage(),
  ]) {
    expect(html).toContain('href="/catalog"');
  }
});
