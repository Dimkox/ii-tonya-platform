import {
  PrivacyApiError,
  PrivacyClient,
  type BrowserSession,
} from "./privacy-client.js";
import { readMiniAppLaunchData } from "./telegram-launch.js";
import { bindBookingActions } from "./booking-view.js";

const labels: Record<string, string> = {
  client_profile: "Профиль клиента",
  client_messaging: "Сообщения в клиентском диалоге",
  follow_up: "Необязательное сопровождение",
  expert_note: "Заметка эксперту",
  expert_handoff: "Передача выбранному эксперту",
  selarti_ai_processing: "Обработка внешним ИИ",
};
const escape = (text: string) =>
  text.replace(
    /[&<>"']/gu,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );
function page(title: string): string {
  return `<a class="skip-link" href="#account-content">Перейти к содержанию</a>
    <header class="site-header legal-header"><a class="brand" href="/" aria-label="ии-Тоня — на главную"><span>ии-</span>Тоня</a><a class="header-action" href="/account">Личный кабинет</a></header>
    <main id="account-content" class="legal-page consent-page" tabindex="-1"><p class="eyebrow">Приватность</p><h1>${title}</h1>
    <p>Каждая цель управляется отдельно. Вход подтверждает твой аккаунт и сам по себе не даёт согласия на обработку сообщений, передачу эксперту или ИИ.</p>
    <section data-account-login><button class="button primary" type="button" data-login disabled>Войти через Telegram</button><div data-login-help></div></section>
    <p role="status" aria-live="polite" tabindex="-1" data-account-status>Проверяем доступность входа…</p>
    <button type="button" class="button ghost" data-retry>Обновить</button><div data-account-private></div>
    </main><footer class="legal-footer"><nav aria-label="Навигация"><a href="/catalog">Каталог услуг</a><a href="/consent">Согласия</a><a href="/my-data">Мои данные</a><a href="/privacy">Политика конфиденциальности</a><a href="/">На главную</a></nav></footer>`;
}
export const renderConsentPage = () => page("Твои согласия");
export const renderMyDataPage = () => page("Мои данные");
export const renderAccountPage = () => page("Личный кабинет");

function download(body: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface TelegramWindow extends Window {
  Telegram?: { WebApp?: { initData?: string } };
  onClientTelegramAuth?: (user: Record<string, unknown>) => void;
}
export function bindPrivacyActions(root: ParentNode): void {
  // A cached document may retain an obsolete session and in-flight callbacks.
  // Reload via GET rather than reviving controllers or replaying mutations.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
  const launchData = readMiniAppLaunchData(window.location.hash);
  if (window.location.hash.includes("tgWebAppData"))
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  const client = new PrivacyClient();
  const status = root.querySelector<HTMLElement>("[data-account-status]")!;
  const privateArea = root.querySelector<HTMLElement>(
    "[data-account-private]",
  )!;
  const loginSection = root.querySelector<HTMLElement>("[data-account-login]")!;
  const login = root.querySelector<HTMLButtonElement>("[data-login]")!;
  const help = root.querySelector<HTMLElement>("[data-login-help]")!;
  let session: BrowserSession | undefined;
  let busy = false;
  let disposeBooking: (() => void) | undefined;
  client.onAuthorityChange(() => {
    disposeBooking?.();
    disposeBooking = undefined;
    privateArea.replaceChildren();
    session = undefined;
    status.textContent =
      "Сессия изменилась. Нажми «Обновить», чтобы проверить текущий аккаунт. Старые действия недоступны.";
  });
  const message = (text: string) => {
    status.textContent = text;
  };
  async function confirmed(text: string) {
    try {
      await refresh();
      message(text);
    } catch {
      message(
        `${text} Не удалось обновить состояние. Нажми «Обновить» для проверки.`,
      );
    }
  }
  async function refresh() {
    disposeBooking?.();
    disposeBooking = undefined;
    privateArea.replaceChildren();
    login.disabled = true;
    session = await client.probe();
    loginSection.hidden = client.authenticated;
    if (!session.available) {
      message(
        "Вход сейчас недоступен. Публичные документы доступны по ссылкам ниже.",
      );
      return;
    }
    login.disabled = false;
    help.replaceChildren();
    if (
      session.botUsername &&
      /^[A-Za-z0-9_]{2,29}bot$/iu.test(session.botUsername)
    ) {
      const link = document.createElement("a");
      link.href = `https://t.me/${session.botUsername}`;
      link.textContent = "Открыть клиентского бота";
      link.rel = "noopener noreferrer";
      const hint = document.createElement("p");
      hint.textContent =
        "В обычном браузере открой бота и выбери в его меню «Личный кабинет». В приложении Telegram нажми кнопку входа выше.";
      help.append(hint, link);
    }
    if (!client.authenticated) {
      message("Войди, чтобы управлять согласиями и получить копию данных.");
      return;
    }
    privateArea.innerHTML =
      '<button class="button ghost" type="button" data-logout disabled>Выйти</button>';
    if (window.location.pathname.replace(/\/+$/u, "") === "/account") {
      const bookingArea = document.createElement("section");
      bookingArea.dataset.bookingArea = "";
      bookingArea.setAttribute("aria-label", "Запись к эксперту");
      privateArea.append(bookingArea);
      disposeBooking = bindBookingActions(bookingArea, client, session);
    }
    if (!session.privacyAvailable) {
      message("Вход выполнен. Управление данными сейчас недоступно.");
      return;
    }
    const states = await client.list();
    privateArea.insertAdjacentHTML(
      "beforeend",
      `<h2>Твои согласия</h2><p>Открой документ и прочитай его перед отдельным решением. Наличие согласия не включает подробный режим, ИИ или передачу эксперту.</p>
      <div class="consent-list">${Object.entries(labels)
        .map(([purpose, label]) => {
          const current = states.find((s) => s.purpose === purpose);
          return `<section class="consent-card" data-purpose="${purpose}"><h3>${label}</h3><p>${current?.inForce ? "Действует" : "Не действует"}${current ? ` · ${escape(current.policyVersion)}` : ""}</p><button type="button" class="button ghost" data-open-document="${purpose}">Прочитать документ</button>${current?.inForce ? `<button type="button" class="button ghost" data-withdraw="${purpose}">Отозвать согласие</button>` : ""}<div data-document></div></section>`;
        })
        .join("")}</div>
      <div class="hero-actions"><button class="button ghost" type="button" data-withdraw-all ${states.some((s) => s.inForce) ? "" : "disabled"}>Отозвать все действующие согласия</button><button class="button primary" type="button" data-export-data>Скачать мои данные</button></div>
      <p>Удаление через кабинет пока недоступно: полнота удаления и подтверждения от обработчиков и резервных копий ещё не проверены. Запрос не отправлен. Контакты для обращения указаны в <a href="/privacy">политике конфиденциальности</a>.</p>`,
    );
    privateArea
      .querySelectorAll<HTMLButtonElement>("[data-open-document]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void act(button, async () => {
              const purpose = button.dataset.openDocument!;
              const section = button.closest("[data-purpose]")!;
              const panel =
                section.querySelector<HTMLElement>("[data-document]")!;
              panel.replaceChildren();
              const view = await client.present(purpose);
              const title = document.createElement("h4");
              title.textContent = view.document.title;
              const metadata = document.createElement("p");
              metadata.textContent = `Версия ${view.document.version} · SHA-256 ${view.document.textSha256}`;
              metadata.className = "document-metadata";
              const body = document.createElement("pre");
              body.className = "consent-document";
              body.textContent = view.document.body;
              panel.append(title, metadata, body);
              const copy = document.createElement("button");
              copy.className = "button ghost";
              copy.textContent = "Скачать документ";
              copy.onclick = () =>
                download(
                  view.document.body,
                  `consent-${purpose}-v${view.document.version}.txt`,
                  "text/plain;charset=utf-8",
                );
              panel.append(copy);
              const current = states.find((s) => s.purpose === purpose);
              for (const decision of ["granted", "denied"] as const) {
                if (
                  current?.inForce &&
                  (decision === "denied" ||
                    current.policyVersion === view.policyVersion)
                )
                  continue;
                const action = document.createElement("button");
                action.className = "button ghost";
                action.type = "button";
                action.dataset.decision = decision;
                action.textContent =
                  decision === "granted"
                    ? "Даю согласие по этому документу"
                    : "Не даю согласие";
                action.onclick = () =>
                  void act(action, async () => {
                    // A failed or uncertain decision cannot reuse this presentation.
                    panel
                      .querySelectorAll("[data-decision]")
                      .forEach((control) => control.remove());
                    const hint = document.createElement("p");
                    hint.textContent =
                      "Для нового решения открой актуальный документ снова. Результат запроса требует подтверждения.";
                    panel.append(hint);
                    await client.decide(purpose, decision);
                    await confirmed("Решение сохранено.");
                  });
                panel.append(action);
              }
              message("Документ открыт. Решение ещё не отправлено.");
            }),
        ),
      );
    bindWithdrawals();
    message(
      "Вход выполнен. Согласия и права на данные доступны независимо от согласия на диалог.",
    );
  }
  function bindWithdrawals() {
    privateArea
      .querySelectorAll<HTMLButtonElement>("[data-withdraw]")
      .forEach((button) =>
        button.addEventListener(
          "click",
          () =>
            void act(button, async () => {
              await client.withdraw(button.dataset.withdraw!);
              await confirmed("Согласие отозвано.");
            }),
        ),
      );
    const all = privateArea.querySelector<HTMLButtonElement>(
      "[data-withdraw-all]",
    )!;
    all.onclick = () =>
      void act(all, async () => {
        const result = await client.withdrawAll();
        const failed = result.failed.length
          ? ` Результат не подтверждён для: ${result.failed.map((p) => labels[p] ?? p).join(", ")}.`
          : "";
        if (result.interrupted) {
          const notAttempted = result.notAttempted?.length
            ? ` Не отправлены отзывы для: ${result.notAttempted.map((p) => labels[p] ?? p).join(", ")}.`
            : "";
          privateArea.replaceChildren();
          session = undefined;
          loginSection.hidden = true;
          root.querySelector<HTMLButtonElement>("[data-retry]")!.textContent =
            "Обновить состояние";
          message(
            `Сессия изменилась или истекла либо запрос отклонён её защитой. Дальнейшие отзывы остановлены. Для исходной операции подтверждено отзывов: ${result.withdrawn.length}.${failed}${notAttempted} Итог исходной операции не подтверждён. Нажми «Обновить состояние» и проверь аккаунт. Продолжение возможно только новым явным действием.`,
          );
          return;
        }
        const snapshot = !result.verified
          ? " Итоговый список согласий не подтверждён. Обнови состояние перед новой попыткой."
          : result.remainingActive.length
            ? ` На момент проверки остаются действующими: ${result.remainingActive.map((p) => labels[p] ?? p).join(", ")}.`
            : " На момент проверки действующих согласий нет.";
        await confirmed(
          `Подтверждено отзывов: ${result.withdrawn.length}.${failed}${snapshot}`,
        );
      });
    const exportButton =
      privateArea.querySelector<HTMLButtonElement>("[data-export-data]")!;
    exportButton.onclick = () =>
      void act(exportButton, async () => {
        const data = await client.export();
        download(
          JSON.stringify(data, null, 2),
          "my-data.json",
          "application/json",
        );
        message("Файл с доступными данными подготовлен для скачивания.");
      });
  }
  async function act(button: HTMLButtonElement, action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    const purpose =
      button.closest<HTMLElement>("[data-purpose]")?.dataset.purpose;
    const disabled = new Map<HTMLButtonElement, boolean>();
    root.querySelectorAll<HTMLButtonElement>("button").forEach((control) => {
      // Booking owns its own async locks; restoring privacy's snapshot must
      // never overwrite a newer booking controller state.
      if (control.closest("[data-booking-area]")) return;
      disabled.set(control, control.disabled);
      control.disabled = true;
    });
    const focused = document.activeElement === button;
    privateArea.setAttribute("aria-busy", "true");
    button.disabled = true;
    message("Выполняем запрос…");
    try {
      await action();
    } catch (error) {
      if (
        error instanceof PrivacyApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        privateArea.replaceChildren();
        loginSection.hidden = false;
        try {
          await refresh();
        } catch {
          /* The retry action remains available. */
        }
        message(
          error.status === 403
            ? "Запрос отклонён защитой сессии и не повторён. Проверь обновлённое состояние; если оно недоступно, нажми «Обновить». Для решения открой документ снова."
            : "Сессия истекла или вход отклонён. Открой кабинет заново из Telegram и войди.",
        );
      } else
        message(
          error instanceof PrivacyApiError && error.status === 409
            ? "Документ или состояние изменились. Обнови страницу и прочитай актуальный документ перед новым решением."
            : "Результат запроса не подтверждён. Документ или сервис могут быть недоступны. Обнови состояние; для решения открой документ снова.",
        );
    } finally {
      busy = false;
      privateArea.removeAttribute("aria-busy");
      disabled.forEach((wasDisabled, control) => {
        if (control.isConnected) control.disabled = wasDisabled;
      });
      login.disabled = !session?.available;
      const logout =
        privateArea.querySelector<HTMLButtonElement>("[data-logout]");
      if (logout) logout.disabled = false;
      if (focused) {
        const target =
          button.isConnected && !button.disabled && !button.closest("[hidden]")
            ? button
            : purpose
              ? root.querySelector<HTMLButtonElement>(
                  `[data-open-document="${purpose}"]`,
                )
              : null;
        (target ?? status).focus();
      }
    }
  }
  root.querySelector<HTMLButtonElement>("[data-retry]")!.onclick = (event) =>
    void act(event.currentTarget as HTMLButtonElement, refresh);
  privateArea.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      "[data-logout]",
    );
    if (button)
      void act(button, async () => {
        disposeBooking?.();
        disposeBooking = undefined;
        await client.logout();
        await confirmed("Ты вышел из кабинета.");
      });
  });
  login.onclick = () =>
    void act(login, async () => {
      if (!session?.available) {
        await refresh();
        return;
      }
      const initData =
        launchData ||
        (window as TelegramWindow).Telegram?.WebApp?.initData ||
        "";
      if (initData) {
        await client.login(`mini:${initData}`);
        await confirmed("Вход выполнен.");
        return;
      }
      if (!session.widgetEnabled || !session.botUsername) {
        message(
          "Для входа открой клиентского бота и выбери «Личный кабинет» в его меню.",
        );
        return;
      }
      const target = window as TelegramWindow;
      target.onClientTelegramAuth = (user) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(user)) {
          if (typeof value !== "string" && typeof value !== "number") {
            message("Telegram не подтвердил вход.");
            return;
          }
          params.set(key, String(value));
        }
        void act(login, async () => {
          await client.login(`widget:${params}`);
          await confirmed("Вход выполнен.");
        });
      };
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.async = true;
      script.dataset.telegramLogin = session.botUsername;
      script.dataset.size = "large";
      script.dataset.onauth = "onClientTelegramAuth(user)";
      script.onerror = () =>
        message("Виджет входа недоступен. Используй меню клиентского бота.");
      help.append(script);
      message(
        "Подтверди вход в виджете Telegram. Если он недоступен, используй меню бота.",
      );
    });
  void act(root.querySelector<HTMLButtonElement>("[data-retry]")!, refresh);
}
