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
> &
  Partial<
    Pick<
      ExpertVerificationClient,
      | "reverifyProfile"
      | "previewReview"
      | "confirmReview"
      | "closeUnknownReview"
      | "privateEvidence"
      | "privateDocumentLink"
      | "privateRecovery"
    >
  > & {
    readonly cards?: ExpertCardAdminClient;
  };
const privateLabels: Record<string, string> = {
  brief: "Бриф",
  education: "Образование",
  propertyEvidence: "Помещение",
  tourMedia: "Фото и видео",
  licence: "Лицензия",
  followup: "Дополнительный файл",
  allocated: "Ожидает обработки",
  inflight: "Обрабатывается",
  unknown: "Результат неизвестен",
  verified: "Файл сохранён",
  unavailable: "Недоступен — нужна ручная проверка",
  MATCH: "Специальность совпадает",
  MISMATCH: "Специальность отличается",
  NO_DOCUMENT: "Документ не предоставлен",
  UNKNOWN: "Результат неизвестен",
};
const privateRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
function documentObservation(value: unknown) {
  const o = privateRecord(value);
  return [
    privateLabels[String(o.result)] ?? "Нужна ручная проверка",
    ...(
      [
        ["institution", "Учебное заведение"],
        ["specialty", "Специальность"],
        ["year", "Год"],
      ] as const
    ).flatMap(([k, label]) =>
      o[k] !== null && o[k] !== undefined ? [`${label}: ${String(o[k])}`] : [],
    ),
    "Подлинность и лицензии оценивает сотрудник.",
  ].join(". ");
}
function privateEvidenceLines(value: unknown) {
  const e = privateRecord(value),
    r = privateRecord(e.result),
    lines = [
      e.current === false
        ? "Наблюдения устарели. Ожидается обновление; не используйте их как текущие."
        : "Наблюдения помогают ручной проверке. Оценка качества не настроена.",
    ];
  if (!r.social) return [...lines, "Проверка ещё не завершена."];
  if (r.education === "NO_DOCUMENT")
    lines.push("Документ об образовании не предоставлен.");
  for (const raw of Array.isArray(r.social) ? r.social.slice(0, 10) : []) {
    const o = privateRecord(raw);
    lines.push(
      `${String(o.profile ?? "Профиль")}: ${o.coverage === "complete_latest" ? "получены последние публикации" : o.coverage === "partial" ? "частичные наблюдения" : "данные недоступны"}. ${o.source === "telegram_public_preview" ? "Неофициальный публичный просмотр. " : ""}${o.activity === "INACTIVE" ? "Последняя публикация более 30 дней назад." : o.activity === "ACTIVE" ? "Есть недавняя публикация." : "Активность неизвестна."} Проверено: ${String(o.observedAt ?? "неизвестно")}. Действительно до: ${String(o.expiresAt ?? "неизвестно")}.`,
    );
    for (const rawPost of Array.isArray(o.posts) ? o.posts.slice(0, 5) : []) {
      const post = privateRecord(rawPost);
      lines.push(
        `Публикация ${String(post.publishedAt ?? "без даты")}: ${post.hasMedia ? "есть фото или видео" : "без наблюдаемого медиа"}; комментарии: ${post.comments === null ? "неизвестно" : String(post.comments ?? "неизвестно")}.`,
      );
    }
  }
  return lines;
}
function recoveryText(value: unknown) {
  const r = privateRecord(value);
  return `Файл ${String(r.id ?? "")}: ${r.deleteState === "unknown" ? "удаление не подтверждено" : "ожидает удаления"}. Попыток сверки: ${String(r.attempts ?? 0)}.`;
}
export function renderExpertVerificationPage(): string {
  return `<main class="section" aria-labelledby="verification-title"><h1 id="verification-title">Проверка заявок экспертов</h1><p>Внутренний интерфейс сотрудников. Требуется действующий административный сеанс с актуальной MFA.</p><label>Токен существующего сеанса <input data-verification-token type="password" autocomplete="off" spellcheck="false" maxlength="512"></label><button type="button" data-verification-connect>Открыть очередь</button><button type="button" data-verification-logout disabled>Завершить сеанс</button><button type="button" data-verification-refresh disabled>Обновить очередь</button><button type="button" data-verification-private-recovery>Незавершённое удаление файлов</button><p data-verification-status role="status" aria-live="polite">Введите токен административного сеанса.</p><section aria-label="Очередь заявок" data-verification-queue></section><section aria-label="Защищённая заявка" data-verification-detail></section><button type="button" data-verification-profile disabled>Подтвердить текущие параметры тарифа</button><div><label>Причина отказа <select data-verification-reason disabled><option value="credentials_incomplete">Недостаточно подтверждений</option><option value="outside_scope">Не соответствует условиям</option><option value="owner_requested">По запросу заявителя</option></select></label><button type="button" data-verification-approve disabled>Согласовано</button><button type="button" data-verification-reject disabled>Отказано</button></div><label>Номер существующего счёта (для восстановления) <input data-verification-invoice type="text" autocomplete="off" spellcheck="false" maxlength="36" disabled></label><button type="button" data-verification-recover disabled>Проверить / восстановить ссылку на оплату</button><section data-verification-payment aria-label="Счёт за онбординг"></section>${renderExpertCardReview()}</main>`;
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
    profileButton = el<HTMLButtonElement>("profile"),
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
    detailGeneration = 0,
    mounted = true;
  function controls() {
    const active = !!client;
    const recoveryControl = root.querySelector<HTMLButtonElement>(
      "[data-verification-private-recovery]",
    );
    if (recoveryControl) recoveryControl.disabled = busy || !active;
    connect.disabled = busy;
    token.disabled = busy;
    logout.disabled = !active;
    refresh.disabled = !active || busy;
    const item = pending.get(selected?.applicationId ?? "");
    approve.disabled =
      !active ||
      busy ||
      selected?.status !== "pending" ||
      (selected.questionnaire.status === "submitted" &&
        selected.questionnaire.formVersion === 2) ||
      (!!selected.profile && !selected.profile.verified) ||
      (!!item && item.decision !== "approved");
    reject.disabled =
      !active ||
      busy ||
      selected?.status !== "pending" ||
      (selected.questionnaire.status === "submitted" &&
        selected.questionnaire.formVersion === 2) ||
      (!!item && item.decision !== "rejected");
    if (profileButton)
      profileButton.disabled =
        !active ||
        busy ||
        !selected?.profile ||
        selected.profile.verified ||
        !client?.reverifyProfile;
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
    detailGeneration++;
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
  async function load(afterApplication?: string) {
    if (!client || busy || !mounted) return;
    const current = client,
      epoch = generation;
    busy = true;
    clearDetail();
    queue.replaceChildren();
    status.textContent = "Загружаем очередь…";
    controls();
    try {
      const values = await current.list(afterApplication);
      if (!mounted || epoch !== generation) return;
      for (const item of values) {
        const b = doc.createElement("button");
        b.type = "button";
        b.textContent = `${item.applicationId} · ${item.maskedContact} · ${item.priceMinor} коп. / ${item.termMonths} мес.`;
        b.onclick = () => void open(item.applicationId);
        queue.append(b);
      }
      if (values.length === 50) {
        const next = doc.createElement("button");
        next.type = "button";
        next.textContent = "Следующая страница очереди";
        next.onclick = () =>
          void load(values[values.length - 1]!.applicationId);
        queue.append(next);
      }
      if (afterApplication) {
        const first = doc.createElement("button");
        first.type = "button";
        first.textContent = "Начало очереди";
        first.onclick = () => void load();
        queue.append(first);
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
  async function open(id: string, historyCursor?: string) {
    if (!client || busy || !mounted) return;
    const current = client,
      epoch = generation;
    busy = true;
    clearDetail();
    const detailEpoch = detailGeneration;
    const currentDetail = () =>
      mounted && epoch === generation && detailEpoch === detailGeneration;
    status.textContent = "Загружаем защищённые данные…";
    controls();
    try {
      const item = await current.detail(id, historyCursor);
      if (!currentDetail()) return;
      selected = item;
      text(detail, `Заявка ${item.applicationId}: ${item.status}`);
      text(
        detail,
        `Тариф: ${item.priceMinor} коп., ${item.termMonths} мес. Предложение ${item.quoteId}.`,
      );
      for (const contact of item.contact)
        text(detail, `${contact.provider}: ${contact.externalId}`);
      if (item.questionnaire.status === "waiting_content")
        text(detail, item.questionnaire.contentSlot);
      else {
        text(
          detail,
          `Анкета v${item.questionnaire.formVersion}, ревизия ${item.questionnaire.revision}. Состояние: ${item.questionnaire.lifecycle}. Проверки документов и соцсетей: неизвестно, требуется ручная оценка.`,
        );
        if (current.privateEvidence) {
          let documentsAfter: string | undefined;
          const evidenceButton = doc.createElement("button");
          evidenceButton.textContent = "Документы и наблюдения";
          detail.append(evidenceButton);
          evidenceButton.onclick = async () => {
            evidenceButton.disabled = true;
            try {
              const evidence = await current.privateEvidence!(
                item.applicationId,
                documentsAfter,
              );
              if (!currentDetail()) return;
              documentsAfter =
                evidence.documents.length === 30
                  ? evidence.documents.at(-1)?.id
                  : undefined;
              evidenceButton.textContent = documentsAfter
                ? "Следующие документы"
                : "Обновить документы и наблюдения";
              for (const line of privateEvidenceLines(evidence.evidence))
                text(detail, line);
              for (const document of evidence.documents) {
                text(
                  detail,
                  `${privateLabels[document.purpose] ?? "Документ"}: ${privateLabels[document.state] ?? "Результат неизвестен"}. ${documentObservation(document.observation)}`,
                );
                if (document.state === "unknown" && current.privateRecovery) {
                  const reconcile = doc.createElement("button");
                  reconcile.textContent = "Сверить неизвестную загрузку";
                  detail.append(reconcile);
                  reconcile.onclick = async () => {
                    try {
                      await current.privateRecovery!(document.id);
                      reconcile.disabled = true;
                    } catch (error) {
                      if (currentDetail()) failed(error);
                    }
                  };
                }
                if (
                  document.state === "verified" &&
                  current.privateDocumentLink
                ) {
                  const button = doc.createElement("button");
                  button.textContent = "Открыть документ на 120 секунд";
                  detail.append(button);
                  button.onclick = async () => {
                    button.disabled = true;
                    try {
                      const url = await current.privateDocumentLink!(
                        item.applicationId,
                        document.id,
                      );
                      if (!currentDetail()) return;
                      const link = doc.createElement("a");
                      link.href = url;
                      link.target = "_blank";
                      link.rel = "noopener noreferrer";
                      link.textContent =
                        "Скачать документ (ссылка действует 120 секунд)";
                      detail.append(link);
                      setTimeout(() => link.remove(), 120000);
                    } catch (error) {
                      if (currentDetail()) failed(error);
                    } finally {
                      button.disabled = false;
                    }
                  };
                }
              }
            } catch (error) {
              if (currentDetail()) failed(error);
            } finally {
              evidenceButton.disabled = false;
            }
          };
        }
        if (current.privateRecovery) {
          let recoveryAfter: string | undefined;
          const recoveryButton = doc.createElement("button");
          recoveryButton.textContent = "Незавершённое удаление файлов";
          detail.append(recoveryButton);
          recoveryButton.onclick = async () => {
            try {
              const rows = await current.privateRecovery!(
                undefined,
                recoveryAfter,
              );
              if (!currentDetail()) return;
              recoveryAfter =
                Array.isArray(rows) && rows.length === 50
                  ? String(rows.at(-1)?.id)
                  : undefined;
              recoveryButton.textContent = recoveryAfter
                ? "Следующие незавершённые удаления"
                : "Обновить незавершённые удаления";
              if (!currentDetail()) return;
              if (Array.isArray(rows))
                for (const row of rows) {
                  text(detail, recoveryText(row));
                  if (
                    row &&
                    typeof row === "object" &&
                    typeof row.id === "string"
                  ) {
                    const retry = doc.createElement("button");
                    retry.textContent = "Повторить сверку удаления";
                    detail.append(retry);
                    retry.onclick = async () => {
                      try {
                        await current.privateRecovery!(row.id);
                        retry.disabled = true;
                      } catch (error) {
                        if (currentDetail()) failed(error);
                      }
                    };
                  }
                }
            } catch (error) {
              if (currentDetail()) failed(error);
            }
          };
        }
        for (const [field, value] of Object.entries(item.questionnaire.draft))
          text(
            detail,
            `${field}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
          );
        for (const message of item.questionnaire.messages ?? []) {
          text(detail, `Доставка ${message.eventId}: ${message.status}.`);
          if (
            ["dispatched", "unknown"].includes(message.status) &&
            current.closeUnknownReview
          ) {
            const close = doc.createElement("button");
            close.textContent = "Закрыть неопределённую доставку без повтора";
            close.onclick = async () => {
              if (busy) return;
              busy = true;
              controls();
              try {
                await current.closeUnknownReview!(
                  item.applicationId,
                  message.eventId,
                );
                if (currentDetail()) {
                  close.remove();
                  status.textContent =
                    "Неопределённая доставка закрыта без повторной отправки.";
                }
              } catch (e) {
                failed(e);
              } finally {
                busy = false;
                controls();
              }
            };
            detail.append(close);
          }
        }
        const nextCursor = item.questionnaire.history?.nextCursor;
        if (nextCursor) {
          const next = doc.createElement("button");
          next.textContent = "Следующая страница истории";
          next.onclick = () => void open(id, nextCursor);
          detail.append(next);
        }
        if (historyCursor) {
          const first = doc.createElement("button");
          first.textContent = "Начало истории";
          first.onclick = () => void open(id);
          detail.append(first);
        }
        if (item.questionnaire.supplements)
          text(
            detail,
            `Дополнения: ${JSON.stringify(item.questionnaire.supplements)}`,
          );
        if (
          item.questionnaire.formVersion === 2 &&
          item.questionnaire.lifecycle === "UNDER_REVIEW"
        )
          reviewEditor(current, item, epoch);
      }
      if (item.profile)
        text(
          detail,
          `Параметры тарифа, версия ${item.profile.revision}: город ${item.profile.cityCode}, миллионник ${item.profile.millionCity ? "да" : "нет"}, формат ${item.profile.serviceFormat}, средний чек ${item.profile.ticketMinor} коп. ${item.profile.verified ? "Подтверждены." : "Требуют подтверждения сотрудником."}`,
        );
      status.textContent = "Заявка загружена. Решение принимает сотрудник.";
    } catch (error) {
      if (currentDetail()) failed(error);
    } finally {
      if (currentDetail()) {
        busy = false;
        controls();
      }
    }
  }
  function reviewEditor(
    current: Client,
    item: VerificationDetail,
    epoch: number,
  ) {
    if (item.questionnaire.status !== "submitted") return;
    const form = item.questionnaire;
    const panel = doc.createElement("section"),
      action = doc.createElement("select"),
      questions = doc.createElement("textarea"),
      tone = doc.createElement("select"),
      previewButton = doc.createElement("button"),
      confirmButton = doc.createElement("button"),
      preview = doc.createElement("textarea");
    action.setAttribute("aria-label", "Решение по анкете");
    for (const [value, label] of [
      ["APPROVED_BASIC", "Одобрить базовый"],
      ["APPROVED_EXCLUSIVE", "Одобрить эксклюзив"],
      ["REQ_INFO_GENERIC", "Запросить информацию"],
      ["REJECT_NICHE_MISMATCH", "Отказать: формат"],
      ["REJECT_INSUFFICIENT_PROOF", "Отказать после уточнений"],
      ["REJECT_LEGAL_VIOLATION", "Окончательный отказ"],
      [
        "REJECT_POST_PAYMENT_REFUND",
        "Возврат — ручная проверка, политика не согласована",
      ],
    ]) {
      const option = doc.createElement("option");
      option.value = value!;
      option.textContent = label!;
      option.disabled = value === "REJECT_POST_PAYMENT_REFUND";
      action.append(option);
    }
    questions.setAttribute("aria-label", "Вопросы, по одному на строку");
    questions.maxLength = 2100;
    tone.setAttribute("aria-label", "Тон сообщения");
    for (const [v, l] of [
      ["standard", "Стандартный"],
      ["warm", "Тёплый"],
      ["brief", "Краткий"],
    ]) {
      const o = doc.createElement("option");
      o.value = v!;
      o.textContent = l!;
      tone.append(o);
    }
    previewButton.textContent = "Предпросмотр";
    confirmButton.textContent = "Подтвердить точный текст";
    confirmButton.disabled = true;
    preview.readOnly = true;
    preview.setAttribute("aria-label", "Точный текст сообщения");
    let prepared:
      | Awaited<ReturnType<ExpertVerificationClient["previewReview"]>>
      | undefined;
    let editorRevision = 0;
    const invalidate = () => {
      editorRevision++;
      prepared = undefined;
      preview.value = "";
      confirmButton.disabled = true;
    };
    action.onchange = invalidate;
    questions.oninput = invalidate;
    tone.onchange = invalidate;
    previewButton.onclick = async () => {
      if (!current.previewReview || busy) return;
      busy = true;
      controls();
      invalidate();
      const requestedRevision = editorRevision;
      try {
        const result = await current.previewReview(item.applicationId, {
          key: action.value,
          expectedRevision: form.revision,
          expectedGeneration: form.generation,
          tone: tone.value,
          ...(action.value === "REQ_INFO_GENERIC"
            ? {
                questions: questions.value
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              }
            : {}),
        });
        if (
          !mounted ||
          epoch !== generation ||
          requestedRevision !== editorRevision
        )
          return;
        prepared = result;
        preview.value = result.text;
        confirmButton.disabled = false;
      } catch (e) {
        if (
          mounted &&
          epoch === generation &&
          requestedRevision === editorRevision
        )
          failed(e);
      } finally {
        busy = false;
        controls();
      }
    };
    confirmButton.onclick = async () => {
      if (!prepared || !current.confirmReview || busy) return;
      busy = true;
      controls();
      confirmButton.disabled = true;
      try {
        await current.confirmReview(
          item.applicationId,
          prepared.previewId,
          prepared.hash,
        );
        if (!mounted || epoch !== generation) return;
        status.textContent =
          "Решение записано. Доставка ожидает доступного канала; это не подтверждение оплаты.";
        panel.remove();
      } catch (e) {
        failed(e);
        confirmButton.disabled = false;
      } finally {
        busy = false;
        controls();
      }
    };
    text(
      panel,
      "Изменяйте тон и вопросы до предпросмотра. Произвольное редактирование итогового текста недоступно: факты решения и сроки защищены. Критерии категорий: ожидается контент. Возвраты требуют ручной проверки и согласованной политики.",
    );
    panel.append(
      action,
      questions,
      tone,
      previewButton,
      preview,
      confirmButton,
    );
    detail.append(panel);
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
  const globalRecovery = root.querySelector<HTMLButtonElement>(
    "[data-verification-private-recovery]",
  );
  if (globalRecovery)
    globalRecovery.onclick = async () => {
      if (!client?.privateRecovery || busy || !mounted) return;
      const current = client,
        epoch = generation;
      clearDetail();
      const detailEpoch = detailGeneration;
      const currentDetail = () =>
        mounted && epoch === generation && detailEpoch === detailGeneration;
      globalRecovery.disabled = true;
      try {
        const after = globalRecovery.dataset.after;
        const rows = await current.privateRecovery!(undefined, after);
        if (!currentDetail()) return;
        const next =
          Array.isArray(rows) && rows.length === 50
            ? String(rows.at(-1)?.id)
            : undefined;
        if (next) globalRecovery.dataset.after = next;
        else delete globalRecovery.dataset.after;
        globalRecovery.textContent = next
          ? "Следующие незавершённые удаления"
          : "Незавершённое удаление файлов";

        if (Array.isArray(rows))
          for (const row of rows) {
            text(detail, recoveryText(row));
            if (row && typeof row === "object" && typeof row.id === "string") {
              const retry = doc.createElement("button");
              retry.textContent = "Повторить сверку удаления";
              detail.append(retry);
              retry.onclick = async () => {
                try {
                  await current.privateRecovery!(row.id);
                  retry.disabled = true;
                } catch (error) {
                  if (currentDetail()) failed(error);
                }
              };
            }
          }
      } catch (error) {
        if (currentDetail()) failed(error);
      } finally {
        if (currentDetail()) globalRecovery.disabled = false;
      }
    };
  connect.onclick = () => {
    if (globalRecovery) delete globalRecovery.dataset.after;
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
  if (profileButton)
    profileButton.onclick = () => {
      if (!client?.reverifyProfile || busy || !selected?.profile || !mounted)
        return;
      const current = client,
        epoch = generation,
        id = selected.applicationId,
        revision = selected.profile.revision;
      busy = true;
      controls();
      status.textContent = "Подтверждаем показанную версию параметров…";
      void current.reverifyProfile!(id, revision)
        .then(
          () => {
            if (
              mounted &&
              generation === epoch &&
              selected?.applicationId === id &&
              selected.profile?.revision === revision
            ) {
              selected = {
                ...selected,
                profile: { ...selected.profile, verified: true },
              };
              status.textContent =
                "Текущие параметры подтверждены. Новый счёт за онбординг не создаётся.";
            }
          },
          (error) => {
            if (mounted && generation === epoch) failed(error);
          },
        )
        .finally(() => {
          if (mounted && generation === epoch) {
            busy = false;
            controls();
          }
        });
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
    if (profileButton) profileButton.onclick = null;
    connect.onclick =
      logout.onclick =
      refresh.onclick =
      approve.onclick =
      reject.onclick =
      recover.onclick =
        null;
  };
}
