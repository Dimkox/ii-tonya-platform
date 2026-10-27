import {
  BookingClient,
  type ActiveBooking,
  type BookingCard,
} from "./booking-client.js";
import {
  PrivacyApiError,
  type BrowserSession,
  type PrivacyClient,
} from "./privacy-client.js";
import { PublicCatalogClient } from "./catalog-client.js";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
export function bookingStateText(row: ActiveBooking): string {
  switch (row.state) {
    case "calendar_pending":
      return "Эксперт согласовал встречу. Ожидаем подтверждения календаря.";
    case "confirmation_unverified":
      return "Подтверждение этой записи в календаре ещё не проверено. Требуется проверка поддержки.";
    case "cancellation_pending":
      return "Запись отменена у нас. Проверяем отмену в календаре.";
    case "reserved":
      return `Резерв до ${time(row.reservedUntil)}. Встреча ещё не подтверждена.`;
    case "booked":
      return "Встреча подтверждена. Статус оплаты здесь не определяется.";
  }
}
export function renderBookingChoices(
  cards: BookingCard[],
  reserveEnabled: boolean,
): string {
  if (!cards.length)
    return "<p>Нет доступного времени. Можно проверить позже.</p>";
  return cards
    .map(
      (card, index) =>
        `<section class="consent-card"><h3>${escape(card.displayName)}</h3><p>${escape(card.serviceCode)} · ${escape(card.language)}</p>${
          card.availability !== "fresh_slots" ||
          !card.slots.some((slot) => slot.choiceHandle)
            ? "<p>Нет доступного времени для записи.</p>"
            : card.slots
                .map(
                  (slot, slotIndex) =>
                    `<p>${escape(time(slot.startsAt))} (Europe/Moscow) ${reserveEnabled && slot.choiceHandle ? `<button type="button" class="button ghost" data-reserve="${index}:${slotIndex}">Зарезервировать</button>` : ""}</p>`,
                )
                .join("")
        }</section>`,
    )
    .join("");
}

export function bindBookingActions(
  root: HTMLElement,
  sessionClient: PrivacyClient,
  session: BrowserSession,
): () => void {
  const client = new BookingClient(sessionClient);
  client.needsReconciliation = true;
  const epoch = sessionClient.sessionEpoch;
  let disposed = false;
  let busy = false;
  let next: string | null = null;
  let rows: ActiveBooking[] = [];
  let cards: BookingCard[] = [];
  const current = () =>
    !disposed &&
    sessionClient.authenticated &&
    sessionClient.sessionEpoch === epoch;
  root.innerHTML = `<h2>Запись к эксперту</h2><p>Время указано в Europe/Moscow (UTC+3). Резерв не означает оплату или подтверждение встречи.</p><p data-booking-status role="status" aria-live="polite" tabindex="-1"></p><div data-booking-controls></div><div data-booking-choices></div><h3>Мои записи</h3><div data-booking-list></div>`;
  const status = root.querySelector<HTMLElement>("[data-booking-status]")!;
  const controls = root.querySelector<HTMLElement>("[data-booking-controls]")!;
  const choices = root.querySelector<HTMLElement>("[data-booking-choices]")!;
  const list = root.querySelector<HTMLElement>("[data-booking-list]")!;
  const say = (text: string) => {
    if (current()) status.textContent = text;
  };
  const dispose = () => {
    disposed = true;
    client.dispose();
    root.replaceChildren();
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose, { once: true });
  if (!session.bookingAvailable) {
    status.textContent =
      "Запись пока недоступна для этой сессии. Выйди и войди заново через Telegram. Если доступ не появился, сервис записи ещё не включён.";
    return dispose;
  }
  function updateButtons() {
    root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled =
        busy ||
        ((button.hasAttribute("data-reserve") ||
          button.hasAttribute("data-cancel")) &&
          client.needsReconciliation);
    });
  }
  async function load(after?: string) {
    const page = await client.list(after);
    if (!current()) return;
    rows =
      after === undefined
        ? page.bookings
        : [
            ...rows,
            ...page.bookings.filter(
              (row) =>
                !rows.some((old) => old.bookingHandle === row.bookingHandle),
            ),
          ];
    next = page.nextCursor;
    list.innerHTML = rows.length
      ? rows
          .map(
            (row, index) =>
              `<section class="consent-card"><p>${escape(time(row.startsAt))} (Europe/Moscow)</p><p>${escape(bookingStateText(row))}</p>${row.state === "cancellation_pending" ? "" : `<button type="button" class="button ghost" data-cancel="${index}">Отменить запись</button>`}</section>`,
          )
          .join("")
      : "<p>Активных записей нет.</p>";
    if (next)
      list.insertAdjacentHTML(
        "beforeend",
        '<button type="button" class="button ghost" data-next>Загрузить следующие записи</button>',
      );
    if (client.needsReconciliation)
      say(
        "Загрузи оставшиеся записи для сверки состояния. Новые изменения пока заблокированы.",
      );
  }
  async function run(action: () => Promise<void>) {
    if (busy || !current()) return;
    busy = true;
    updateButtons();
    root.setAttribute("aria-busy", "true");
    try {
      await action();
    } catch (error) {
      if (!current()) {
        dispose();
        return;
      }
      if (
        error instanceof PrivacyApiError &&
        [401, 403].includes(error.status)
      ) {
        client.dispose();
        controls.replaceChildren();
        choices.replaceChildren();
        list.replaceChildren();
        status.textContent =
          "Сессия изменилась или запрос отклонён. Нажми «Обновить» в кабинете. Действие не повторялось.";
      } else
        say(
          error instanceof Error && error.message === "catalog_pending"
            ? "Каталог ещё готовится. Нажми «Найти время», чтобы повторить поиск."
            : error instanceof PrivacyApiError && error.status === 404
              ? "Время устарело или запись недоступна. Обнови список и выбери время заново."
              : error instanceof PrivacyApiError && error.status === 409
                ? "Время уже занято или состояние изменилось. Обнови список."
                : "Результат запроса не подтверждён. Нажми «Сверить мои записи». До сверки новые изменения заблокированы.",
        );
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
      if (current()) {
        updateButtons();
        status.focus();
      }
    }
  }
  root.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!target || target.disabled) return;
    if (target.hasAttribute("data-reconcile"))
      void run(async () => {
        await load();
        if (!client.needsReconciliation)
          say(
            "Список записей обновлён. Любое новое действие нужно выбрать отдельно.",
          );
      });
    else if (target.hasAttribute("data-next") && next) {
      const cursor = next;
      void run(() => load(cursor));
    } else if (target.hasAttribute("data-find"))
      void run(async () => {
        choices.replaceChildren();
        cards = [];
        const serviceCode =
          root.querySelector<HTMLSelectElement>("[data-service]")!.value;
        const language =
          root.querySelector<HTMLSelectElement>("[data-language]")!.value;
        say("Ищем доступное время…");
        cards = await client.catalog({
          ...(serviceCode ? { serviceCode } : {}),
          ...(language ? { language } : {}),
        });
        if (current()) {
          choices.innerHTML = renderBookingChoices(
            cards,
            session.bookingReserveAvailable === true,
          );
          say("Поиск завершён. Выбери время отдельной кнопкой.");
        }
      });
    else if (target.dataset.reserve)
      void run(async () => {
        const [index, slotIndex] = target.dataset
          .reserve!.split(":")
          .map(Number);
        const handle = cards[index!]?.slots[slotIndex!]?.choiceHandle;
        if (!handle) return;
        await client.reserve(handle);
        await load();
        say(
          "Результат резерва проверен по списку записей. Резерв не означает оплату или подтверждение встречи.",
        );
      });
    else if (target.dataset.cancel)
      void run(async () => {
        const row = rows[Number(target.dataset.cancel)];
        if (!row) return;
        const cancellation = await client.cancel(row.bookingHandle);
        await load();
        say(
          cancellation === "cancellation_pending"
            ? "Запись отменена у нас. Отмена в календаре ещё проверяется."
            : "Отмена выполнена. Список записей обновлён.",
        );
      });
  });
  controls.innerHTML = `<label>Услуга <select data-service><option value="">Все услуги</option></select></label> <label>Язык <select data-language><option value="">Все языки</option></select></label><button type="button" class="button primary" data-find>Найти время</button><button type="button" class="button ghost" data-reconcile>Сверить мои записи</button>${session.bookingReserveAvailable ? "" : "<p>Создание резервов приостановлено. Просмотр и отмена остаются доступны.</p>"}`;
  void new PublicCatalogClient()
    .list()
    .then((items) => {
      if (!current()) return;
      for (const [selector, values] of [
        ["[data-service]", items.map((item) => item.serviceCode)],
        ["[data-language]", items.map((item) => item.language)],
      ] as const) {
        const select = root.querySelector<HTMLSelectElement>(selector)!;
        for (const value of new Set(values)) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          select.append(option);
        }
      }
    })
    .catch(() => {
      /* Unfiltered structured search remains available. */
    });
  void run(async () => {
    await load();
    if (!client.needsReconciliation) say("Активные записи загружены.");
  });
  return dispose;
}
