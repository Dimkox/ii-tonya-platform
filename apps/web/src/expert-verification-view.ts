import {
  bindExpertCardReview,
  renderExpertCardReview,
} from "./expert-card-view.js";
import type { ExpertCardAdminClient } from "./expert-card-client.js";
import {
  ExpertVerificationClient,
  type VerificationDetail,
  type VerificationDecision,
  type VerificationPayment,
} from "./expert-verification-client.js";
type Client = Pick<
  ExpertVerificationClient,
  "list" | "detail" | "decide" | "recover" | "clear"
> & { readonly cards?: ExpertCardAdminClient };
export function renderExpertVerificationPage(): string {
  return `<main class="section" aria-labelledby="verification-title"><h1 id="verification-title">Проверка заявок экспертов</h1><p>Внутренний интерфейс сотрудников. Требуется действующий административный сеанс с актуальной MFA.</p><label>Токен существующего сеанса <input data-verification-token type="password" autocomplete="off" spellcheck="false" maxlength="512"></label><button type="button" data-verification-connect>Открыть очередь</button><button type="button" data-verification-logout disabled>Завершить сеанс</button><button type="button" data-verification-refresh disabled>Обновить очередь</button><p data-verification-status role="status" aria-live="polite">Введите токен административного сеанса.</p><section aria-label="Очередь заявок" data-verification-queue></section><section aria-label="Защищённая заявка" data-verification-detail></section><div><label>Причина отказа <select data-verification-reason disabled><option value="credentials_incomplete">Недостаточно подтверждений</option><option value="outside_scope">Не соответствует условиям</option><option value="owner_requested">По запросу заявителя</option></select></label><button type="button" data-verification-approve disabled>Согласовано</button><button type="button" data-verification-reject disabled>Отказано</button></div><label>Номер существующего счёта (для восстановления) <input data-verification-invoice type="text" autocomplete="off" spellcheck="false" maxlength="36" disabled></label><button type="button" data-verification-recover disabled>Проверить / восстановить ссылку на оплату</button><section data-verification-payment aria-label="Счёт за онбординг"></section>${renderExpertCardReview()}</main>`;
}
export function bindExpertVerificationActions(
  root: HTMLElement,
  deps: {
    createClient?: (token: string) => Client;
    randomKey?: () => string;
  } = {},
): () => void {
  const el = <T extends HTMLElement>(n: string) =>
    root.querySelector<T>(`[data-verification-${n}]`)!;
  const token = el<HTMLInputElement>("token"),
    connect = el<HTMLButtonElement>("connect"),
    logout = el<HTMLButtonElement>("logout"),
    refresh = el<HTMLButtonElement>("refresh"),
    status = el("status"),
    queue = el("queue"),
    detail = el("detail"),
    approve = el<HTMLButtonElement>("approve"),
    reject = el<HTMLButtonElement>("reject"),
    reason = el<HTMLSelectElement>("reason"),
    recover = el<HTMLButtonElement>("recover"),
    payment = el("payment"),
    invoice = el<HTMLInputElement>("invoice");
  const doc = root.ownerDocument,
    win = doc.defaultView;
  const pending = new Map<
    string,
    {
      decision: "approved" | "rejected";
      reasonCode: string;
      idempotencyKey: string;
    }
  >();
  let client: Client | undefined,
    selected: VerificationDetail | undefined,
    invoiceId: string | undefined,
    busy = false,
    generation = 0,
    mounted = true;
  function controls() {
    const active = !!client;
    connect.disabled = busy;
    token.disabled = busy;
    logout.disabled = !active;
    refresh.disabled = !active || busy;
    const item = pending.get(selected?.applicationId ?? "");
    approve.disabled =
      !active ||
      busy ||
      selected?.status !== "pending" ||
      (!!item && item.decision !== "approved");
    reject.disabled =
      !active ||
      busy ||
      selected?.status !== "pending" ||
      (!!item && item.decision !== "rejected");
    reason.disabled = reject.disabled || !!item;
    invoiceId =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        invoice.value,
      )
        ? invoice.value
        : undefined;
    invoice.disabled = !active || busy;
    recover.disabled = !active || busy || !invoiceId;
    cardReview?.sync();
  }
  function clearDetail() {
    selected = undefined;
    invoiceId = undefined;
    invoice.value = "";
    detail.replaceChildren();
    payment.replaceChildren();
    controls();
  }
  function end() {
    generation++;
    client?.clear();
    client = undefined;
    cardReview?.reset();
    busy = false;
    token.value = "";
    pending.clear();
    queue.replaceChildren();
    clearDetail();
    status.textContent =
      "Сеанс завершён. Для доступа снова введите действующий токен.";
    controls();
  }
  function failed(error: unknown) {
    if (
      error instanceof Error &&
      error.message === "verification_unauthorized"
    ) {
      end();
      status.textContent =
        "Сеанс недействителен или недостаточно прав. Защищённые данные очищены.";
    } else
      status.textContent =
        "Ответ не подтверждён. Повторите ту же команду или обновите очередь.";
  }
  function text(parent: HTMLElement, value: string) {
    const p = doc.createElement("p");
    p.textContent = value;
    parent.append(p);
  }
  function showPayment(value: VerificationPayment | undefined) {
    payment.replaceChildren();
    if (!value) return;
    if (invoiceId) text(payment, `Счёт: ${invoiceId}`);
    const labels = {
      waiting_configuration:
        "Счёт подготовлен. Платёжный переход пока недоступен.",
      unavailable: "Ссылка недоступна. Используйте проверку / восстановление.",
      pending: "Результат ещё не подтверждён. Повторите проверку позже.",
      not_repeated:
        "Повторная команда учтена. Используйте восстановление ссылки.",
      settled:
        "Оплата подтверждена сервером. Платёж за онбординг не активирует резидентство.",
      cancelled: "Счёт закрыт; доступ не открыт.",
    };
    if (value.status !== "ready") {
      text(payment, labels[value.status]);
      return;
    }
    const link = doc.createElement("a");
    link.textContent = "Оплатить онбординг";
    link.href = value.url;
    link.rel = "noopener noreferrer";
    payment.append(link);
    text(payment, "Переход по ссылке сам по себе не подтверждает оплату.");
  }
  async function load() {
    if (!client || busy || !mounted) return;
    const current = client,
      epoch = generation;
    busy = true;
    clearDetail();
    queue.replaceChildren();
    status.textContent = "Загружаем очередь…";
    controls();
    try {
      const values = await current.list();
      if (!mounted || epoch !== generation) return;
      for (const item of values) {
        const b = doc.createElement("button");
        b.type = "button";
        b.textContent = `${item.applicationId} · ${item.maskedContact} · ${item.priceMinor} коп. / ${item.termMonths} мес.`;
        b.onclick = () => void open(item.applicationId);
        queue.append(b);
      }
      status.textContent = values.length
        ? `Заявок в загруженной очереди: ${values.length}.`
        : "Ожидающих заявок нет.";
    } catch (error) {
      if (mounted && epoch === generation) failed(error);
    } finally {
      if (mounted && epoch === generation) {
        busy = false;
        controls();
      }
    }
  }
  async function open(id: string) {
    if (!client || busy || !mounted) return;
    const current = client,
      epoch = generation;
    busy = true;
    clearDetail();
    status.textContent = "Загружаем защищённые данные…";
    controls();
    try {
      const item = await current.detail(id);
      if (!mounted || epoch !== generation) return;
      selected = item;
      text(detail, `Заявка ${item.applicationId}: ${item.status}`);
      text(
        detail,
        `Тариф: ${item.priceMinor} коп., ${item.termMonths} мес. Предложение ${item.quoteId}.`,
      );
      for (const contact of item.contact)
        text(detail, `${contact.provider}: ${contact.externalId}`);
      text(detail, item.questionnaire.contentSlot);
      status.textContent = "Заявка загружена. Решение принимает сотрудник.";
    } catch (error) {
      if (mounted && epoch === generation) failed(error);
    } finally {
      if (mounted && epoch === generation) {
        busy = false;
        controls();
      }
    }
  }
  async function decide(decision: "approved" | "rejected") {
    if (
      !client ||
      busy ||
      !selected ||
      selected.status !== "pending" ||
      !mounted
    )
      return;
    const current = client,
      epoch = generation,
      id = selected.applicationId;
    let command = pending.get(id);
    if (command && command.decision !== decision) return;
    command ??= {
      decision,
      reasonCode: decision === "approved" ? "verified" : reason.value,
      idempotencyKey: (deps.randomKey ?? (() => crypto.randomUUID()))(),
    };
    pending.set(id, command);
    busy = true;
    controls();
    status.textContent = "Сохраняем решение…";
    try {
      const result: VerificationDecision = await current.decide(
        id,
        command.decision,
        command.reasonCode,
        command.idempotencyKey,
      );
      if (!mounted || epoch !== generation) return;
      if (result.decision !== command.decision)
        throw new Error("verification_invalid_response");
      selected = { ...selected!, status: result.decision };
      pending.delete(id);
      invoiceId = result.invoiceId ?? undefined;
      invoice.value = invoiceId ?? "";
      showPayment(result.payment);
      status.textContent =
        result.decision === "approved"
          ? "Согласование сохранено. Счёт за онбординг подготовлен; резидентство ещё не активно."
          : "Отказ сохранён. Шаблон уведомления ожидает подготовки.";
    } catch (error) {
      if (mounted && epoch === generation) failed(error);
    } finally {
      if (mounted && epoch === generation) {
        busy = false;
        controls();
      }
    }
  }
  connect.onclick = () => {
    if (busy || !mounted) return;
    const value = token.value;
    end();
    try {
      client = (deps.createClient ?? ((v) => new ExpertVerificationClient(v)))(
        value,
      );
    } catch {
      status.textContent =
        "Введите действующий токен административного сеанса.";
      controls();
      return;
    }
    controls();
    void load();
  };
  logout.onclick = end;
  refresh.onclick = () => void load();
  approve.onclick = () => void decide("approved");
  reject.onclick = () => void decide("rejected");
  invoice.oninput = controls;
  recover.onclick = () => {
    if (!client || busy || !invoiceId || !mounted) return;
    const current = client,
      epoch = generation,
      id = invoiceId;
    busy = true;
    controls();
    status.textContent = "Проверяем существующий счёт…";
    void current
      .recover(id)
      .then(
        (value) => {
          if (mounted && epoch === generation) {
            showPayment(value);
            status.textContent = "Состояние существующего счёта обновлено.";
          }
        },
        (error) => {
          if (mounted && epoch === generation) failed(error);
        },
      )
      .finally(() => {
        if (mounted && epoch === generation) {
          busy = false;
          controls();
        }
      });
  };
  const cardRoot = root.querySelector<HTMLElement>("[data-expert-card-root]");
  const cardReview = cardRoot
    ? bindExpertCardReview(cardRoot, {
        getClient: () => client?.cards,
        onUnauthorized: end,
        ...(deps.randomKey ? { randomKey: deps.randomKey } : {}),
      })
    : undefined;
  win?.addEventListener("pagehide", end);
  controls();
  return () => {
    end();
    mounted = false;
    cardReview?.dispose();
    win?.removeEventListener("pagehide", end);
    invoice.oninput = null;
    connect.onclick =
      logout.onclick =
      refresh.onclick =
      approve.onclick =
      reject.onclick =
      recover.onclick =
        null;
  };
}
