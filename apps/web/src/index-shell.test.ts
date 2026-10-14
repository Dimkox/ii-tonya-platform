import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);

/**
 * TRACK-01 и T27: публичная оболочка не загружает и не отправляет ничего
 * стороннего до выбора пользователя. Аналитика может оставаться полностью
 * выключенной — это не требует согласия на первом экране.
 *
 * Тест намеренно негативный: возвращённый сторонний тег, `noscript`-пиксель
 * или inline-скрипт делают его красным.
 */
describe("public HTML shell loads nothing third-party", () => {
  it("has no inline scripts", () => {
    const inline = [
      ...indexHtml.matchAll(
        /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gu,
      ),
    ];

    expect(inline.map(([, body]) => (body ?? "").trim())).toEqual([]);
  });

  it("references no host but our own", () => {
    const urls = [...indexHtml.matchAll(/https?:\/\/([^"' />\s]+)/gu)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined);

    for (const url of urls) {
      expect(
        url.startsWith("ii-tonya.ru") || url.startsWith("www.ii-tonya.ru"),
      ).toBe(true);
    }
  });

  it("has no analytics, tag-manager or tracking-beacon vocabulary", () => {
    expect(indexHtml).not.toMatch(
      /mc\.yandex|metrika|googletagmanager|google-analytics|hotjar|top\.mail|facebook|gtag\(/iu,
    );
  });

  it("keeps the no-JavaScript fallback free of any network request", () => {
    const noScriptContent = indexHtml.match(
      /<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/u,
    )?.[1];

    expect(noScriptContent).toBeDefined();
    expect(noScriptContent).not.toMatch(/<img|<script|url\(/iu);
    expect(noScriptContent).toContain(
      "Для открытия диалога и полной навигации включите JavaScript.",
    );
  });

  it("keeps exactly one first-party module entry point", () => {
    const scripts = [...indexHtml.matchAll(/<script\b[^>]*>/gu)].map(
      (m) => m[0],
    );

    expect(scripts).toEqual(['<script type="module" src="/src/main.ts">']);
  });
});
