import {
  ExpertAccountClient,
  type ExpertBrowserSession,
} from "./expert-account-client.js";
import { readMiniAppLaunchData } from "./telegram-launch.js";
export function renderExpertAccountPage(): string {
  return `<main class="section"><a href="/">ии-Тоня</a><h1>Кабинет эксперта</h1><p data-expert-status role="status">Проверяем вход…</p><button class="button primary" data-expert-login disabled>Войти через Telegram</button><button class="button" data-expert-logout hidden>Выйти</button><button class="button" data-expert-retry>Проверить вход</button><div data-expert-help></div><p>Оплата и управление тарифом пока недоступны.</p></main>`;
}
interface ExpertWindow extends Window {
  Telegram?: { WebApp?: { initData?: string } };
  onExpertTelegramAuth?: (user: Record<string, unknown>) => void;
}
export function bindExpertAccountActions(
  root: HTMLElement,
  client = new ExpertAccountClient(),
): void {
  const status = root.querySelector<HTMLElement>("[data-expert-status]")!;
  const login = root.querySelector<HTMLButtonElement>("[data-expert-login]")!;
  const logout = root.querySelector<HTMLButtonElement>("[data-expert-logout]")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-expert-retry]")!;
  const help = root.querySelector<HTMLElement>("[data-expert-help]")!;
  let session: ExpertBrowserSession | undefined,
    epoch = 0;
  let loggingOut = false;
  const launch = readMiniAppLaunchData(window.location.hash);
  if (window.location.hash)
    history.replaceState(null, "", window.location.pathname);
  function paint() {
    status.textContent = session?.authenticated
      ? "Вход выполнен. Кабинет эксперта."
      : session?.available
        ? "Войдите через Telegram."
        : "Вход временно недоступен.";
    login.disabled = !session?.available;
    login.hidden = session?.authenticated === true;
    logout.hidden = session?.authenticated !== true;
  }
  function fail(error: unknown) {
    session = undefined;
    paint();
    status.textContent =
      error instanceof Error && error.message === "expert_login_denied"
        ? "Вход отклонён. Нужен действующий подтверждённый профиль эксперта."
        : "Вход временно недоступен. Повторите проверку.";
  }
  async function probe() {
    if (loggingOut) return;
    const current = ++epoch;
    status.textContent = "Проверяем вход…";
    try {
      const result = await client.probe();
      if (current !== epoch) return;
      session = result;
      paint();
    } catch (error) {
      if (current === epoch) fail(error);
    }
  }
  async function authenticate(proof: string) {
    if (loggingOut) return;
    const current = ++epoch;
    login.disabled = true;
    status.textContent = "Выполняем вход…";
    try {
      await client.login(proof);
      if (current !== epoch) return;
      await probe();
    } catch (error) {
      if (current === epoch) fail(error);
    }
  }
  login.onclick = () => {
    if (!session?.available) return;
    const initData =
      launch || (window as ExpertWindow).Telegram?.WebApp?.initData;
    if (initData) {
      void authenticate(`mini:${initData}`);
      return;
    }
    help.replaceChildren();
    if (!session.widgetEnabled || !session.botUsername) {
      help.textContent =
        "Откройте бота эксперта и выберите кабинет в его меню.";
      return;
    }
    const widgetEpoch = epoch;
    (window as ExpertWindow).onExpertTelegramAuth = (user) => {
      if (widgetEpoch !== epoch) return;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(user)) {
        if (typeof value !== "string" && typeof value !== "number") return;
        params.set(key, String(value));
      }
      void authenticate(`widget:${params}`);
    };
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.dataset.telegramLogin = session.botUsername;
    script.dataset.size = "large";
    script.dataset.onauth = "onExpertTelegramAuth(user)";
    script.onerror = () => {
      help.textContent =
        "Виджет недоступен. Откройте кабинет из бота эксперта.";
    };
    help.append(script);
  };
  logout.onclick = () => {
    if (loggingOut) return;
    loggingOut = true;
    retry.disabled = true;
    const current = ++epoch;
    session = undefined;
    help.replaceChildren();
    paint();
    status.textContent = "Выходим…";
    void client.logout().then(
      () => {
        loggingOut = false;
        retry.disabled = false;
        if (current === epoch) void probe();
      },
      (error) => {
        loggingOut = false;
        retry.disabled = false;
        if (current === epoch) fail(error);
      },
    );
  };
  retry.onclick = () => {
    void probe();
  };
  void probe();
}
