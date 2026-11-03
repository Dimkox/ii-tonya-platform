import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_CHOICE_KEY,
  clearOptionalAnalyticsIds,
  isPrivateRoute,
  mayOfferAnalytics,
  readAnalyticsChoice,
  renderCookieBanner,
  writeAnalyticsChoice,
} from "./analytics-consent.js";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("TRACK-02: analytics choice only on the public landing", () => {
  it.each([
    "/consent",
    "/my-data",
    "/account",
    "/expert/account",
    "/admin/expert-verification",
    "/catalog",
  ])("never offers analytics on private screen %s", (route) => {
    expect(isPrivateRoute(route)).toBe(true);
    expect(mayOfferAnalytics(route)).toBe(false);
  });
  it("offers the choice on the landing and not on legal pages", () => {
    expect(mayOfferAnalytics("/")).toBe(true);
    expect(mayOfferAnalytics("/privacy")).toBe(false);
  });
  it("banner offers accept and decline, links the policy, loads nothing", () => {
    const html = renderCookieBanner();
    expect(html).toContain('data-cookie-choice="granted"');
    expect(html).toContain('data-cookie-choice="denied"');
    expect(html).toContain('href="/privacy"');
    expect(html).not.toMatch(/<script|<img|<iframe|https?:/iu);
  });
});

describe("choice storage", () => {
  it("unknown or missing value means no choice (analytics off)", () => {
    expect(readAnalyticsChoice(memoryStorage())).toBeUndefined();
    expect(
      readAnalyticsChoice(memoryStorage({ [ANALYTICS_CHOICE_KEY]: "yes" })),
    ).toBeUndefined();
  });
  it("TRACK-06: decline removes optional first-party analytics ids", () => {
    const storage = memoryStorage({ _ym_uid: "1", _ga: "2", keep: "3" });
    const doc = { cookie: "_ym_d=1; session=abc" };
    writeAnalyticsChoice(storage, "denied", doc);
    expect([...storage.map.keys()].sort()).toEqual([
      ANALYTICS_CHOICE_KEY,
      "keep",
    ]);
    expect(doc.cookie).toBe("_ym_d=; Max-Age=0; Path=/; SameSite=Lax");
    expect(readAnalyticsChoice(storage)).toBe("denied");
  });
  it("survives a throwing storage", () => {
    const broken = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    expect(readAnalyticsChoice(broken)).toBeUndefined();
    expect(() => {
      writeAnalyticsChoice(broken, "granted");
      clearOptionalAnalyticsIds(broken, undefined);
    }).not.toThrow();
  });
});

describe("TRACK-03: private part bootstraps clean", () => {
  const sources = readdirSync(new URL(".", import.meta.url))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => readFileSync(new URL(name, import.meta.url), "utf8"));
  it("no SPA navigation: private screens open by full page load", () => {
    for (const source of sources) expect(source).not.toMatch(/pushState\(/u);
  });
  it("no analytics loader or recorder anywhere in the web app", () => {
    for (const source of sources)
      expect(source).not.toMatch(
        /mc\.yandex|metrika|webvisor|googletagmanager|google-analytics|gtag\(/iu,
      );
  });
});
