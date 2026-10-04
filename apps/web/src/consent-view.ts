const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export type ConsentPurpose = "client_messaging" | "client_profile";

const labels: Record<ConsentPurpose, { title: string; description: string }> = {
  client_messaging: {
    title: "Сообщения в клиентском диалоге",
    description:
      "Сохранять и использовать сообщения, чтобы продолжать твой диалог с ии-Тоней.",
  },
  client_profile: {
    title: "Профиль клиента",
    description:
      "Использовать сохранённые настройки профиля для персонализации диалога.",
  },
};

export function renderConsentPage(): string {
  const rows = (Object.keys(labels) as ConsentPurpose[])
    .map(
      (purpose) =>
        `<label class="consent-choice"><input type="checkbox" data-consent-purpose="${purpose}"><span><strong>${labels[purpose].title}</strong><small>${labels[purpose].description}</small></span></label>`,
    )
    .join("");
  return `<a class="skip-link" href="#consent-content">Перейти к содержанию</a>
    <header class="site-header legal-header"><a class="brand" href="/" aria-label="ии-Тоня — на главную"><span>ии-</span>Тоня</a><a class="header-action" href="/my-data">Мои данные</a></header>
    <main id="consent-content" class="legal-page consent-page"><p class="eyebrow">Настройки приватности</p><h1>Твои согласия</h1>
      <p>Каждая цель управляется отдельно. Без действующего согласия клиентские данные не используются для этой цели.</p>
      <form data-consent-form><fieldset><legend class="sr-only">Цели обработки</legend>${rows}</fieldset><button class="button primary" type="submit">Сохранить выбор</button><p role="status" aria-live="polite" data-consent-status></p></form>
    </main><footer class="legal-footer"><nav aria-label="Навигация"><a href="/privacy">Политика конфиденциальности</a><a href="/">На главную</a></nav></footer>`;
}

export function renderMyDataPage(): string {
  return `<a class="skip-link" href="#my-data-content">Перейти к содержанию</a>
    <header class="site-header legal-header"><a class="brand" href="/" aria-label="ии-Тоня — на главную"><span>ии-</span>Тоня</a><a class="header-action" href="/consent">Согласия</a></header>
    <main id="my-data-content" class="legal-page consent-page"><p class="eyebrow">Приватность</p><h1>Мои данные</h1><p>Здесь можно запросить копию доступных данных или начать их удаление.</p>
      <div class="hero-actions"><button class="button primary" type="button" data-export-data>Скачать мои данные</button><button class="button ghost" type="button" data-erase-data>Начать удаление</button></div><p role="status" aria-live="polite" data-privacy-status></p><pre class="privacy-export" data-export-result hidden></pre>
    </main><footer class="legal-footer"><nav aria-label="Навигация"><a href="/privacy">Политика конфиденциальности</a><a href="/">На главную</a></nav></footer>`;
}

const jsonRequest = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init.headers },
  });

export function bindPrivacyActions(root: ParentNode): void {
  const consentForm = root.querySelector<HTMLFormElement>(
    "[data-consent-form]",
  );
  const consentStatus = root.querySelector<HTMLElement>(
    "[data-consent-status]",
  );
  consentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (consentStatus) consentStatus.textContent = "Сохраняем выбор…";
    try {
      const choices = [
        ...root.querySelectorAll<HTMLInputElement>("[data-consent-purpose]"),
      ];
      for (const choice of choices) {
        const purpose = choice.dataset.consentPurpose as ConsentPurpose;
        const presentation = await jsonRequest(
          "/v1/client/privacy/presentations",
          {
            method: "POST",
            body: JSON.stringify({
              purpose,
              channel: "web",
              documentKey: `consent.${purpose}`,
            }),
          },
        );
        if (!presentation.ok) throw new Error("presentation_failed");
        const token = ((await presentation.json()) as { token?: unknown })
          .token;
        if (typeof token !== "string") throw new Error("presentation_invalid");
        const decision = await jsonRequest("/v1/client/privacy/decisions", {
          method: "POST",
          body: JSON.stringify({
            token,
            purpose,
            decision: choice.checked ? "granted" : "denied",
            policyVersion: "client-consent-v1",
          }),
        });
        if (!decision.ok) throw new Error("decision_failed");
      }
      if (consentStatus) consentStatus.textContent = "Выбор сохранён.";
    } catch {
      if (consentStatus)
        consentStatus.textContent =
          "Не удалось сохранить выбор. Попробуй ещё раз.";
    }
  });

  const status = root.querySelector<HTMLElement>("[data-privacy-status]");
  root
    .querySelector<HTMLButtonElement>("[data-export-data]")
    ?.addEventListener("click", async () => {
      if (status) status.textContent = "Готовим выгрузку…";
      try {
        const response = await jsonRequest("/v1/client/privacy/export");
        if (!response.ok) throw new Error("export_failed");
        const result = root.querySelector<HTMLElement>("[data-export-result]");
        if (result) {
          result.textContent = JSON.stringify(await response.json(), null, 2);
          result.hidden = false;
        }
        if (status) status.textContent = "Готово.";
      } catch {
        if (status) status.textContent = "Не удалось получить данные.";
      }
    });
  root
    .querySelector<HTMLButtonElement>("[data-erase-data]")
    ?.addEventListener("click", async () => {
      if (
        !window.confirm("Начать удаление данных? Это действие нельзя отменить.")
      )
        return;
      if (status) status.textContent = "Запрашиваем удаление…";
      try {
        const response = await jsonRequest("/v1/client/privacy/erase", {
          method: "POST",
          body: "",
        });
        if (!response.ok) throw new Error("erase_failed");
        if (status) status.textContent = "Запрос принят.";
      } catch {
        if (status)
          status.textContent = "Не удалось принять запрос. Попробуй ещё раз.";
      }
    });
}
