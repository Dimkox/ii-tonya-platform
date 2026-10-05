import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderCatalogPage } from "./catalog-view.js";
import { readPublicConfig } from "./config.js";
import {
  renderAccountPage,
  renderConsentPage,
  renderMyDataPage,
} from "./consent-view.js";
import { renderLanding } from "./landing-view.js";
import { renderLegalPage } from "./legal-view.js";

const shell = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const pages = [
  ["/", () => renderLanding(readPublicConfig({})), "main-content"],
  ["/catalog", renderCatalogPage, "catalog-content"],
  ["/account", renderAccountPage, "account-content"],
  ["/consent", renderConsentPage, "account-content"],
  ["/my-data", renderMyDataPage, "account-content"],
  ["/privacy", () => renderLegalPage("privacy"), "legal-content"],
  ["/oferta", () => renderLegalPage("oferta"), "legal-content"],
] as const;

describe("composed public page landmarks", () => {
  it.each(pages)(
    "%s has one main content target outside navigation",
    (_path, render, target) => {
      const content = render();
      // Exercise each real renderer inside the actual shared mount element.
      // With scripting enabled, body noscript contents are inactive text, not
      // landmark elements. This is a bounded string check; browser DOM probes
      // separately verify parsing, ancestry and focus behavior.
      const html = shell
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gu, "")
        .replace(
          /(<([a-z]+)\b[^>]*\bid="app"[^>]*>)\s*(<\/\2>)/u,
          (_match, opening: string, _tag: string, closing: string) =>
            `${opening}${content}${closing}`,
        );
      expect(html).toContain(content);
      expect(html.match(/<main\b/gu)).toHaveLength(1);
      expect(html.match(/<\/main>/gu)).toHaveLength(1);
      expect(html.match(/<h1\b/gu)).toHaveLength(1);
      expect(html.match(/<header\b/gu)).toHaveLength(1);
      expect(html.match(/<footer\b/gu)).toHaveLength(1);
      expect(html).toContain(`href="#${target}"`);
      expect(html).toMatch(new RegExp(`<main\\b[^>]*\\bid="${target}"`, "u"));
      expect(html.match(/<main\b[^>]*>/u)?.[0]).toContain('tabindex="-1"');
      expect([
        ...html.matchAll(new RegExp(`\\bid="${target}"`, "gu")),
      ]).toHaveLength(1);
      const targetIndex = html.search(
        new RegExp(`<[^>]+\\bid="${target}"`, "u"),
      );
      expect(targetIndex).toBeGreaterThanOrEqual(html.indexOf("<main"));
      expect(targetIndex).toBeLessThan(html.indexOf("</main>"));
      expect(html.indexOf("</header>")).toBeLessThan(html.indexOf("<main"));
      expect(html.indexOf("<footer")).toBeGreaterThan(html.indexOf("</main>"));
    },
  );

  it("has one accessible main and heading without JavaScript and preserves the fallback sentence", () => {
    const fallback = shell.match(
      /<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/u,
    )?.[1];
    expect(fallback).toBeDefined();
    expect(fallback!.match(/<main\b/gu)).toHaveLength(1);
    expect(fallback!.match(/<\/main>/gu)).toHaveLength(1);
    expect(fallback!.match(/<h1\b/gu)).toHaveLength(1);
    expect(fallback).toContain('aria-labelledby="no-script-heading"');
    expect(fallback).toMatch(
      /<h1\b[^>]*id="no-script-heading"[^>]*>[^<]+<\/h1>/u,
    );
    expect(fallback).toContain(
      "Для открытия диалога и полной навигации включите JavaScript.",
    );
    expect(fallback).not.toMatch(
      /<img|<script|<iframe|<link|\bsrc\s*=|url\(|https?:|mc\.yandex|metrika|googletagmanager/iu,
    );
  });
});
