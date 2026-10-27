import type { PrivacyClient } from "./privacy-client.js";

export function bindAccountPackages(
  root: HTMLElement,
  client: PrivacyClient,
): () => void {
  root.dataset.packagesArea = "";
  root.innerHTML = `<h2>Мои пакеты</h2><p>Онлайн-оплата пока не подключена</p>
    <p data-packages-status role="status" aria-live="polite"></p>
    <p data-packages-as-of></p><p data-packages-total></p><ul data-packages-list></ul>
    <button type="button" class="button ghost" data-packages-retry>Обновить пакеты</button>`;
  const status = root.querySelector<HTMLElement>("[data-packages-status]")!;
  const total = root.querySelector<HTMLElement>("[data-packages-total]")!;
  const asOf = root.querySelector<HTMLElement>("[data-packages-as-of]")!;
  const formatTimestamp = (value: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Etc/GMT-3",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value));
  const list = root.querySelector<HTMLElement>("[data-packages-list]")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-packages-retry]")!;
  const epoch = client.sessionEpoch;
  let disposed = false;
  let generation = 0;
  const clear = () => {
    asOf.textContent = "";
    total.textContent = "";
    list.replaceChildren();
  };
  const current = (request: number) =>
    !disposed &&
    request === generation &&
    epoch === client.sessionEpoch &&
    client.authenticated;
  async function load() {
    const request = ++generation;
    clear();
    retry.disabled = true;
    status.textContent = "Загружаем пакеты…";
    try {
      const data = await client.packages();
      if (!current(request)) return;
      asOf.textContent = `Состояние пакетов на ${formatTimestamp(data.asOf)} (UTC+3). Остатки и статусы показаны на момент проверки.`;
      total.textContent = `Всего осталось сообщений: ${data.totalRemainingUnits}`;
      status.textContent =
        data.packages.length === 0
          ? "Пакетов пока нет."
          : data.hasMore
            ? "Показаны первые 50 пакетов. Итог учитывает все действующие пакеты."
            : "Пакеты загружены.";
      for (const item of data.packages) {
        const row = document.createElement("li");
        const kind = {
          paid: "Оплаченный",
          admin: "Выданный администратором",
          intro: "Вводный",
        }[item.kind];
        const state = {
          active: "Действует",
          expired: "Истёк",
          exhausted: "Исчерпан",
        }[item.status];
        const expiry =
          item.expiresAt === null
            ? "Без срока действия"
            : `До ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Etc/GMT-3", dateStyle: "short", timeStyle: "short" }).format(new Date(item.expiresAt))} (UTC+3)`;
        row.textContent = `${kind}: осталось ${item.remainingUnits} из ${item.grantedUnits}. На момент проверки: ${state}. ${expiry}`;
        list.append(row);
      }
    } catch {
      if (!current(request)) return;
      clear();
      status.textContent = "Не удалось загрузить пакеты. Попробуй ещё раз.";
    } finally {
      if (current(request)) retry.disabled = false;
    }
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ++generation;
    clear();
    root.replaceChildren();
    unsubscribe();
    window.removeEventListener("pagehide", dispose);
  };
  const unsubscribe = client.onAuthorityChange(dispose);
  window.addEventListener("pagehide", dispose);
  retry.onclick = () => {
    if (!disposed) void load();
  };
  void load();
  return dispose;
}
