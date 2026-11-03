/**
 * SCRUM-110 / TRACK-02, TRACK-03, TRACK-06.
 *
 * Analytics stays fully OFF: this module has no loader and no third-party host.
 * The banner records only the visitor's UI choice. Per WEB-05 a local flag is
 * not a legal consent record; any future analytics must load as a separate
 * module only after a server-side `cookies_analytics` = granted.
 */
export type AnalyticsChoice = "granted" | "denied";

export const ANALYTICS_CHOICE_KEY = "ii_tonya_cookies_analytics_choice";

/** Only the public landing may ever show the analytics choice (TRACK-02). */
const PUBLIC_ANALYTICS_ROUTES: ReadonlySet<string> = new Set(["/"]);

/** Screens with personal data: no banner, no recorder, ever (TRACK-02). */
const PRIVATE_ROUTE_PREFIXES = [
  "/consent",
  "/my-data",
  "/account",
  "/expert",
  "/admin",
  "/catalog",
  "/booking",
] as const;

export function isPrivateRoute(route: string): boolean {
  return PRIVATE_ROUTE_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  );
}

export function mayOfferAnalytics(route: string): boolean {
  return PUBLIC_ANALYTICS_ROUTES.has(route) && !isPrivateRoute(route);
}

type ChoiceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  readonly length: number;
  key(index: number): string | null;
};

export function readAnalyticsChoice(
  storage: ChoiceStorage,
): AnalyticsChoice | undefined {
  try {
    const value = storage.getItem(ANALYTICS_CHOICE_KEY);
    return value === "granted" || value === "denied" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Optional first-party analytics identifiers removed on decline (TRACK-06). */
const OPTIONAL_ID_PATTERN = /^(_ym|_ga|_gid|ym_)/u;

export function clearOptionalAnalyticsIds(
  storage: ChoiceStorage,
  doc: Pick<Document, "cookie"> | undefined,
): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && OPTIONAL_ID_PATTERN.test(key)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    /* Storage may be unavailable; nothing optional was written then. */
  }
  if (doc === undefined) return;
  for (const part of doc.cookie.split(";")) {
    const name = part.split("=")[0]?.trim() ?? "";
    if (OPTIONAL_ID_PATTERN.test(name))
      doc.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

export function writeAnalyticsChoice(
  storage: ChoiceStorage,
  choice: AnalyticsChoice,
  doc?: Pick<Document, "cookie">,
): void {
  if (choice === "denied") clearOptionalAnalyticsIds(storage, doc);
  try {
    storage.setItem(ANALYTICS_CHOICE_KEY, choice);
  } catch {
    /* Without storage the banner simply shows again next visit. */
  }
}

/** DRAFT wording for owner review (152-FZ / GDPR style). */
export function renderCookieBanner(): string {
  return `<section class="cookie-banner" role="dialog" aria-live="polite" aria-labelledby="cookie-banner-title" data-cookie-banner>
  <h2 id="cookie-banner-title" class="cookie-banner__title">Файлы cookie</h2>
  <p class="cookie-banner__text">Мы используем строго необходимые cookie — без них сайт не работает, согласие для них не требуется. Аналитические cookie помогают нам понять, как улучшить сайт. Мы включим их только с вашего согласия; до выбора аналитика не работает. Согласие можно отозвать в любой момент. Подробнее — в <a href="/privacy">Политике конфиденциальности</a>.</p>
  <div class="cookie-banner__actions">
    <button type="button" class="button primary" data-cookie-choice="granted">Разрешить аналитику</button>
    <button type="button" class="button" data-cookie-choice="denied">Только необходимые</button>
  </div>
</section>`;
}

export function mountCookieBanner(
  root: HTMLElement,
  route: string,
  storage: ChoiceStorage,
  doc: Document,
): HTMLElement | undefined {
  if (!mayOfferAnalytics(route)) return undefined;
  if (readAnalyticsChoice(storage) !== undefined) return undefined;
  root.insertAdjacentHTML("beforeend", renderCookieBanner());
  const banner = root.querySelector<HTMLElement>("[data-cookie-banner]");
  if (banner === null) return undefined;
  banner.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const choice = target.dataset.cookieChoice;
    if (choice !== "granted" && choice !== "denied") return;
    writeAnalyticsChoice(storage, choice, doc);
    banner.remove();
  });
  return banner;
}
