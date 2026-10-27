import { demoExamples } from "./demo-catalog.js";

const services = demoExamples.map(([, label], index) => ({
  value: `demo-${index + 1}`,
  label,
}));
const times = [
  { value: "example-morning", label: "Пример дня · 10:00" },
  { value: "example-evening", label: "Пример дня · 18:00" },
] as const;
const downloadNotice =
  "Скачанный файл остаётся на устройстве после очистки, перезапуска и перезагрузки демо. Его можно удалить самостоятельно.";
const disclosure = `Демо: деньги не списываются, реальной записи нет, настоящее согласие не сохраняется. Перезагрузка очищает состояние страницы. ${downloadNotice}`;
const serviceLabel = (value: string) =>
  services.find((item) => item.value === value)?.label ?? null;
const timeLabel = (value: string) =>
  times.find((item) => item.value === value)?.label ?? null;

export interface DemoState {
  service: string;
  time: string;
  booking: {
    service: string;
    time: string;
    status: "reserved" | "simulated-paid" | "cancelled";
  } | null;
  consent: "not-granted" | "demo-granted" | "demo-withdrawn";
  notice: string;
}

export type DemoAction =
  | { type: "service" | "time"; value: string }
  | { type: "reserve" | "pay" | "cancel" | "clear" | "reset" }
  | { type: "consent"; granted: boolean };

export function initialDemoState(): DemoState {
  return {
    service: "",
    time: "",
    booking: null,
    consent: "not-granted",
    notice: "Демо готово. Выбери вымышленную услугу и пример времени.",
  };
}

export function transitionDemo(
  state: DemoState,
  action: DemoAction,
): DemoState {
  switch (action.type) {
    case "service":
    case "time": {
      if (state.booking) return state;
      const label =
        action.type === "service"
          ? serviceLabel(action.value)
          : timeLabel(action.value);
      if (action.value !== "" && label === null)
        return { ...state, notice: "Демо: выбери вариант из списка." };
      return {
        ...state,
        [action.type]: action.value,
        notice:
          "Демо: выбор обновлён. Реальные услуги и свободное время не проверяются.",
      };
    }
    case "reserve": {
      if (state.booking) return state;
      const service = serviceLabel(state.service),
        time = timeLabel(state.time);
      if (!service || !time)
        return {
          ...state,
          notice: "Демо: сначала выбери услугу и пример времени.",
        };
      return {
        ...state,
        booking: { service, time, status: "reserved" },
        notice: "Демо-запись создана. Реальная встреча не назначена.",
      };
    }
    case "pay":
      if (state.booking?.status !== "reserved") return state;
      return {
        ...state,
        booking: { ...state.booking, status: "simulated-paid" },
        notice: "Демо-оплата показана. Деньги не списаны.",
      };
    case "cancel":
      if (!state.booking || state.booking.status === "cancelled") return state;
      return {
        ...state,
        booking: { ...state.booking, status: "cancelled" },
        notice:
          "Демо-запись отменена. Денежный возврат не выполнялся: списания не было. Для нового примера нажми «Начать демо заново». Полный перезапуск также сбросит демо-согласие.",
      };
    case "consent":
      return {
        ...state,
        consent: action.granted ? "demo-granted" : "demo-withdrawn",
        notice: `Демо-согласие ${action.granted ? "дано" : "отозвано"}. Реальное согласие не изменено.`,
      };
    case "clear":
      return {
        ...initialDemoState(),
        notice: `Демо очищено: запись, выбор и согласие сброшены. Это не удаление реальных данных. ${downloadNotice}`,
      };
    case "reset":
      return {
        ...initialDemoState(),
        notice: `Демо начато заново. Выбери вымышленную услугу и пример времени. ${downloadNotice}`,
      };
  }
}

export function exportDemoState(state: DemoState): string {
  return JSON.stringify(
    {
      kind: "ii-tonya-synthetic-demo",
      synthetic: true,
      notice: disclosure,
      selection: {
        service: serviceLabel(state.service),
        time: timeLabel(state.time),
      },
      booking: state.booking,
      consent: state.consent,
    },
    null,
    2,
  );
}
export function renderDemoWalkthrough(): string {
  return `<a class="skip-link" href="#demo-content">Перейти к содержанию</a>
    <aside class="demo-banner" data-demo-banner aria-label="Предупреждение о демонстрации">${disclosure}</aside>
    <header class="site-header legal-header demo-header"><a class="brand" href="/" aria-label="ии-Тоня — на главную"><span>ии-</span>Тоня</a><a class="header-action" href="/catalog">Каталог услуг</a></header>
    <main id="demo-content" class="legal-page demo-page" tabindex="-1" aria-labelledby="demo-heading">
      <p class="eyebrow">Интерактивное демо · без входа</p><h1 id="demo-heading">Попробуй сервис</h1>
      <p>Все действия ниже — примеры. Состояние страницы существует только до её закрытия или перезагрузки; скачанный файл сохраняется отдельно. Личные данные вводить не нужно.</p>
      <p role="status" aria-live="polite" aria-atomic="true" tabindex="-1" data-demo-status>${initialDemoState().notice}</p>
      <section class="catalog-card" aria-labelledby="demo-select-heading">
        <h2 id="demo-select-heading">1. Выбери демо-услугу</h2>
        <p>Вымышленные услуги из демонстрационного каталога. Время приведено для примера и не означает доступность специалиста. Цена не назначена.</p>
        <div class="catalog-filters">
          <div><label for="demo-service">Демо-услуга</label><select id="demo-service" data-demo-service><option value="">Выбери услугу</option>${services.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("")}</select></div>
          <div><label for="demo-time">Пример времени</label><select id="demo-time" data-demo-time><option value="">Выбери время</option>${times.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("")}</select></div>
        </div>
        <p data-demo-selection>Демо: услуга и время не выбраны.</p>
        <button class="button primary" type="button" data-demo-reserve disabled>Создать демо-запись</button>
      </section>
      <section class="catalog-card" aria-labelledby="demo-booking-heading">
        <h2 id="demo-booking-heading">2. Демо-запись и оплата</h2>
        <p data-demo-booking data-state="none">Демо-записи пока нет.</p>
        <div class="demo-actions"><button class="button primary" type="button" data-demo-pay disabled>Показать демо-оплату</button><button class="button ghost" type="button" data-demo-cancel disabled>Отменить демо-запись</button></div>
        <p>Демо-оплата не требует карты и не списывает деньги. Отмена не создаёт денежного возврата.</p>
      </section>
      <section class="catalog-card" aria-labelledby="demo-consent-heading">
        <h2 id="demo-consent-heading">3. Пример согласия</h2>
        <label class="demo-consent"><input type="checkbox" data-demo-consent> Дать демо-согласие на пример сопровождения</label>
        <p data-demo-consent-status>Демо-согласие не дано.</p>
        <p>Сними отметку, чтобы показать отзыв. Это упрощённая иллюстрация: реальные согласия и аккаунт не изменяются. В реальном аккаунте каждая цель согласия управляется отдельно.</p>
      </section>
      <section class="catalog-card" aria-labelledby="demo-data-heading">
        <h2 id="demo-data-heading">4. Демо-данные</h2>
        <p>Скачай JSON с вымышленным состоянием или очисти состояние страницы. Это не экспорт и не удаление данных реального аккаунта. ${downloadNotice}</p>
        <div class="demo-actions"><button class="button ghost" type="button" data-demo-export>Скачать демо-данные</button><button class="button ghost" type="button" data-demo-clear>Очистить демо-данные</button><button class="button primary" type="button" data-demo-reset>Начать демо заново</button></div>
      </section>
    </main><footer class="legal-footer"><nav aria-label="Навигация"><a href="/catalog">Каталог услуг</a><a href="/account">Личный кабинет</a><a href="/">На главную</a></nav></footer>`;
}

export function bindDemoWalkthrough(root: ParentNode): void {
  let state = initialDemoState();
  const service = root.querySelector<HTMLSelectElement>("[data-demo-service]")!;
  const time = root.querySelector<HTMLSelectElement>("[data-demo-time]")!;
  const consent = root.querySelector<HTMLInputElement>("[data-demo-consent]")!;
  const status = root.querySelector<HTMLElement>("[data-demo-status]")!;
  const booking = root.querySelector<HTMLElement>("[data-demo-booking]")!;
  const button = (name: string) =>
    root.querySelector<HTMLButtonElement>(`[data-demo-${name}]`)!;
  const bookingLabels = {
    reserved: "Демо-запись создана",
    "simulated-paid": "Демо-оплата показана · деньги не списаны",
    cancelled: "Демо-запись отменена",
  };

  function update() {
    service.value = state.service;
    time.value = state.time;
    service.disabled = time.disabled = state.booking !== null;
    consent.checked = state.consent === "demo-granted";
    root.querySelector<HTMLElement>("[data-demo-selection]")!.textContent =
      `Демо: ${serviceLabel(state.service) ?? "услуга не выбрана"} · ${timeLabel(state.time) ?? "время не выбрано"}.`;
    booking.dataset.state = state.booking?.status ?? "none";
    booking.textContent = state.booking
      ? `${bookingLabels[state.booking.status]}: ${state.booking.service} · ${state.booking.time}. Реальной встречи нет.`
      : "Демо-записи пока нет.";
    root.querySelector<HTMLElement>("[data-demo-consent-status]")!.textContent =
      state.consent === "demo-granted"
        ? "Демо-согласие дано."
        : state.consent === "demo-withdrawn"
          ? "Демо-согласие отозвано."
          : "Демо-согласие не дано.";
    button("reserve").disabled =
      !!state.booking || !serviceLabel(state.service) || !timeLabel(state.time);
    button("pay").disabled = state.booking?.status !== "reserved";
    button("cancel").disabled =
      !state.booking || state.booking.status === "cancelled";
    status.textContent = state.notice;
  }

  function dispatch(action: DemoAction) {
    state = transitionDemo(state, action);
    update();
  }
  service.onchange = () => dispatch({ type: "service", value: service.value });
  time.onchange = () => dispatch({ type: "time", value: time.value });
  consent.onchange = () =>
    dispatch({ type: "consent", granted: consent.checked });
  for (const type of ["reserve", "pay", "cancel", "clear", "reset"] as const) {
    button(type).onclick = () => {
      dispatch({ type });
      if (type === "reset") service.focus();
      else {
        status.focus();
        status.scrollIntoView({ block: "center", behavior: "instant" });
      }
    };
  }
  button("export").onclick = () => {
    let url: string | undefined;
    const link = document.createElement("a");
    try {
      url = URL.createObjectURL(
        new Blob([exportDemoState(state)], { type: "application/json" }),
      );
      link.href = url;
      link.download = "ii-tonya-synthetic-demo.json";
      document.body.append(link);
      link.click();
      status.textContent = `Демо: скачивание вымышленных данных запрошено. Данных реального аккаунта в файле нет. ${downloadNotice}`;
    } catch {
      status.textContent = "Демо: не удалось скачать файл. Попробуй ещё раз.";
    } finally {
      link.remove();
      if (url !== undefined) {
        const createdUrl = url;
        setTimeout(() => URL.revokeObjectURL(createdUrl), 1000);
      }
    }
  };
  // Clear a page kept in the back/forward cache as well as a normal reload.
  window.addEventListener("pagehide", () => {
    state = initialDemoState();
    update();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      state = initialDemoState();
      update();
    }
  });
  update();
}
