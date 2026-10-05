import {
  PublicCatalogClient,
  type PublicCatalogItem,
} from "./catalog-client.js";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/gu,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );

export const renderCatalogPage =
  (): string => `<a class="skip-link" href="#catalog-content">Перейти к содержанию</a>
  <header class="site-header legal-header"><a class="brand" href="/" aria-label="ии-Тоня — на главную"><span>ии-</span>Тоня</a><a class="header-action" href="/account">Личный кабинет</a></header>
  <main id="catalog-content" class="legal-page catalog-page" aria-labelledby="catalog-heading" tabindex="-1"><p class="eyebrow">Опубликованные услуги</p><h1 id="catalog-heading">Каталог услуг</h1>
    <p>Каталог можно смотреть без входа. Личный запрос здесь вводить не нужно.</p>
    <p>Показаны первые 20 опубликованных услуг или меньше. Фильтры работают только с загруженными услугами.</p>
    <p role="status" aria-live="polite" tabindex="-1" data-catalog-status>Загружаем каталог…</p>
    <button class="button ghost" type="button" data-catalog-retry hidden>Повторить загрузку</button>
    <div class="catalog-filters" data-catalog-filters hidden>
      <div><label for="catalog-service">Услуга</label><select id="catalog-service" disabled><option value="">Все услуги</option></select></div>
      <div><label for="catalog-language">Язык</label><select id="catalog-language" disabled><option value="">Все языки</option></select></div>
      <button class="button ghost" type="button" data-catalog-clear>Сбросить фильтры</button>
    </div>
    <div data-catalog-results aria-busy="true"></div>
  </main><footer class="legal-footer"><nav aria-label="Навигация"><a href="/account">Личный кабинет</a><a href="/privacy">Политика конфиденциальности</a><a href="/">На главную</a></nav></footer>`;

const matchingItems = (
  items: readonly PublicCatalogItem[],
  filters: { serviceCode: string; language: string },
) =>
  items.filter(
    (item) =>
      (!filters.serviceCode || item.serviceCode === filters.serviceCode) &&
      (!filters.language || item.language === filters.language),
  );

export function renderCatalogResults(
  items: readonly PublicCatalogItem[],
  filters = { serviceCode: "", language: "" },
): string {
  if (!items.length) return "<p>В каталоге пока нет опубликованных услуг.</p>";
  const visible = matchingItems(items, filters);
  if (!visible.length)
    return "<p>Среди загруженных услуг нет совпадений по выбранным фильтрам. Попробуй изменить или сбросить фильтры.</p>";
  return `<ul class="catalog-list">${visible.map((item) => `<li class="catalog-card" data-catalog-item><h2>${escape(item.displayName)}</h2><p>Услуга: ${escape(item.serviceCode)}</p><p>Язык: ${escape(item.language)}</p></li>`).join("")}</ul>`;
}

export function bindCatalogActions(
  root: ParentNode,
  client: Pick<PublicCatalogClient, "list"> = new PublicCatalogClient(),
): void {
  const status = root.querySelector<HTMLElement>("[data-catalog-status]")!;
  const results = root.querySelector<HTMLElement>("[data-catalog-results]")!;
  const controls = root.querySelector<HTMLElement>("[data-catalog-filters]")!;
  const service = root.querySelector<HTMLSelectElement>("#catalog-service")!;
  const language = root.querySelector<HTMLSelectElement>("#catalog-language")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-catalog-retry]")!;
  const clear = root.querySelector<HTMLButtonElement>("[data-catalog-clear]")!;
  let items: PublicCatalogItem[] = [];
  let generation = 0;
  function render() {
    const filters = { serviceCode: service.value, language: language.value };
    results.innerHTML = renderCatalogResults(items, filters);
    status.textContent = `Показано из загруженных услуг: ${matchingItems(items, filters).length} из ${items.length}.`;
    clear.disabled = !service.value && !language.value;
  }
  function populate(
    select: HTMLSelectElement,
    values: string[],
    label: string,
  ) {
    select.replaceChildren();
    for (const value of ["", ...new Set(values)]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value || label;
      select.append(option);
    }
    select.disabled = false;
  }
  async function load() {
    const current = ++generation;
    let restoreFocus = false;
    retry.disabled = true;
    controls.hidden = true;
    results.replaceChildren();
    results.setAttribute("aria-busy", "true");
    status.textContent = "Загружаем каталог…";
    try {
      const loaded = await client.list();
      if (current !== generation) return;
      restoreFocus = document.activeElement === retry;
      items = loaded;
      populate(
        service,
        items.map((item) => item.serviceCode),
        "Все услуги",
      );
      populate(
        language,
        items.map((item) => item.language),
        "Все языки",
      );
      controls.hidden = items.length === 0;
      retry.hidden = true;
      render();
    } catch {
      if (current !== generation) return;
      restoreFocus = document.activeElement === retry;
      items = [];
      status.textContent = "Не удалось загрузить каталог. Попробуй ещё раз.";
      retry.hidden = false;
    } finally {
      if (current === generation) {
        results.removeAttribute("aria-busy");
        retry.disabled = false;
        if (restoreFocus) status.focus();
      }
    }
  }
  service.onchange = render;
  language.onchange = render;
  clear.onclick = () => {
    service.value = "";
    language.value = "";
    render();
    service.focus();
  };
  retry.onclick = () => void load();
  void load();
}
