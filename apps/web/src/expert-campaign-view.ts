import {
  ExpertCampaignClient,
  campaignMoney,
  type CampaignQuote,
  type CampaignTariff,
} from "./expert-campaign-client.js";
import type { ExpertBrowserSession } from "./expert-account-client.js";

export function bindExpertCampaign(
  root: HTMLElement,
  session: ExpertBrowserSession,
  unauthorized: () => void,
): () => void {
  if (!session.authenticated || !session.csrfToken || !session.userId)
    return () => undefined;
  const client = new ExpertCampaignClient(session.csrfToken);
  root.innerHTML = `<section aria-label="Тариф эксперта"><h2>Тариф эксперта</h2><p data-campaign-status role="status" aria-live="polite">Загружаем тарифы…</p><label>Тариф <select data-campaign-tariff disabled></select></label><p data-campaign-base></p><label>Срок <select data-campaign-term disabled><option value="1">1 месяц</option><option value="3">3 месяца</option></select></label><button class="button" data-campaign-load>Обновить тарифы</button><button class="button primary" data-campaign-quote disabled>Рассчитать стоимость</button><div data-campaign-summary></div><button class="button primary" data-campaign-checkout disabled>Перейти к оплате</button><div data-campaign-payment></div></section>`;
  const element = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-campaign-${name}]`)!;
  const status = element("status"),
    base = element("base"),
    summary = element("summary"),
    payment = element("payment");
  const tariff = element<HTMLSelectElement>("tariff"),
    term = element<HTMLSelectElement>("term");
  const calculate = element<HTMLButtonElement>("quote"),
    checkout = element<HTMLButtonElement>("checkout"),
    load = element<HTMLButtonElement>("load");
  let active = true,
    busy = false,
    tariffs: CampaignTariff[] = [],
    quote: CampaignQuote | undefined;
  let command: { quoteId: string; idempotencyKey: string } | undefined;
  let terminal = false;
  let attempted = false;
  function controls() {
    tariff.disabled = term.disabled = busy || tariffs.length === 0;
    load.disabled = busy;
    calculate.disabled = busy || tariffs.length === 0;
    checkout.disabled = busy || !quote || terminal;
  }
  function clearQuote() {
    quote = undefined;
    command = undefined;
    terminal = false;
    attempted = false;
    summary.replaceChildren();
    payment.replaceChildren();
    checkout.textContent = "Перейти к оплате";
    controls();
  }
  function error(value: unknown) {
    if (!active) return;
    const code = value instanceof Error ? value.message : "";
    if (code === "campaign_unauthorized") {
      unauthorized();
      return;
    }
    if (code === "campaign_rejected") {
      clearQuote();
      status.textContent =
        "Расчёт отклонён или истёк. Рассчитайте стоимость заново.";
    } else {
      status.textContent =
        code === "campaign_invalid_response"
          ? "Некорректный ответ сервера. Повторите запрос."
          : "Сервис временно недоступен. Оплата не подтверждена. Повторите запрос.";
    }
  }
  function selected() {
    const value = tariffs.find((v) => v.tariffVersionId === tariff.value);
    base.textContent = value
      ? `Базовая цена за месяц: ${campaignMoney(value.baseMonthlyMinor)} ₽. Итоговая стоимость — после расчёта.`
      : "";
  }
  async function loadTariffs() {
    if (!active || busy) return;
    busy = true;
    clearQuote();
    tariffs = [];
    tariff.replaceChildren();
    base.textContent = "";
    controls();
    status.textContent = "Загружаем тарифы…";
    try {
      const values = await client.tariffs();
      if (!active) return;
      tariffs = values;
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value.tariffVersionId;
        option.textContent = value.displayName;
        tariff.append(option);
      }
      selected();
      status.textContent = values.length
        ? "Выберите тариф и срок, затем рассчитайте стоимость."
        : "Доступных тарифов пока нет.";
    } catch (value) {
      error(value);
    } finally {
      if (active) {
        busy = false;
        controls();
      }
    }
  }
  tariff.onchange = term.onchange = () => {
    if (busy) return;
    clearQuote();
    selected();
    status.textContent = "Рассчитайте стоимость для выбранного тарифа и срока.";
  };
  calculate.onclick = () => {
    if (
      !active ||
      busy ||
      !tariffs.some((v) => v.tariffVersionId === tariff.value)
    )
      return;
    busy = true;
    clearQuote();
    controls();
    status.textContent = "Рассчитываем стоимость…";
    const input = {
      tariffVersionId: tariff.value,
      termMonths: term.value === "3" ? (3 as const) : (1 as const),
      idempotencyKey: crypto.randomUUID(),
    };
    void client
      .quote(input, session.userId!)
      .then((value) => {
        if (!active) return;
        if (Date.parse(value.expiresAt) <= Date.now()) {
          error(new Error("campaign_rejected"));
          return;
        }
        quote = value;
        command = { quoteId: value.id, idempotencyKey: crypto.randomUUID() };
        summary.textContent = `${value.displayName}. Срок: ${value.termMonths} мес. Итог за месяц: ${campaignMoney(value.monthlyPriceMinor)} ₽. Итого: ${campaignMoney(value.priceMinor)} ₽. Расчёт действует до ${new Date(value.expiresAt).toLocaleString("ru-RU")}. Скидка за энергию: ${campaignMoney(String(value.energyDiscountBps))}%. Стартовая скидка: ${campaignMoney(String(value.startDiscountBps))}%.${value.floorApplied ? " Применена минимальная цена." : ""}`;
        status.textContent = "Стоимость сохранена. Оплата ещё не подтверждена.";
      }, error)
      .finally(() => {
        if (active) {
          busy = false;
          controls();
        }
      });
  };
  checkout.onclick = () => {
    if (!active || busy || !quote || !command || terminal) return;
    if (!attempted && Date.parse(quote.expiresAt) <= Date.now()) {
      error(new Error("campaign_rejected"));
      return;
    }
    busy = true;
    // After submission the order may already exist, even without a response.
    // Its replay validity belongs to the server, not the original quote clock.
    attempted = true;
    payment.replaceChildren();
    controls();
    status.textContent = "Подготавливаем оплату…";
    // Retained across uncertain failures: the server sees the same saved quote
    // and command, even if the original order was created before a lost reply.
    void client
      .checkout(command)
      .then((value) => {
        if (!active) return;
        if (value.checkoutUrl) {
          const link = document.createElement("a");
          link.dataset.campaignLink = "";
          link.href = value.checkoutUrl;
          link.rel = "noopener noreferrer";
          link.referrerPolicy = "no-referrer";
          link.textContent = "Открыть защищённую страницу оплаты";
          payment.append(link);
          status.textContent =
            "Оплата ожидается. Переход или возврат со страницы оплаты не подтверждает платёж.";
        } else {
          status.textContent =
            value.status === "settled"
              ? "Оплачено. Подтверждено сервером."
              : value.status === "quoted"
                ? "Заказ создан. Оплата не подтверждена."
                : "Заказ завершён без действующей оплаты. Для новой покупки рассчитайте стоимость заново.";
          terminal = true;
        }
      }, error)
      .finally(() => {
        if (active) {
          busy = false;
          checkout.textContent = "Повторить запрос оплаты";
          controls();
        }
      });
  };
  load.onclick = () => {
    void loadTariffs();
  };
  void loadTariffs();
  return () => {
    active = false;
    client.dispose();
    quote = undefined;
    command = undefined;
    tariffs = [];
    tariff.onchange = term.onchange = null;
    calculate.onclick = checkout.onclick = load.onclick = null;
    root.replaceChildren();
  };
}
