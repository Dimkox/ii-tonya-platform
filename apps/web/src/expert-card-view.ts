import { richReadablePages } from "./expert-card-rich-view.js";
import {
  validExpertPublicCard,
  type ExpertCardAdminClient,
  type ExpertCardDraft,
  type ExpertPublicCard,
  type CardRevisionCommand,
} from "./expert-card-client.js";
type Pending = (
  | { kind: "edit"; publicCard: ExpertPublicCard }
  | {
      kind: "review";
      action: "approve" | "return_changes";
      warningAcknowledgment?: string;
      returnReason?: string;
    }
  | { kind: "promo" }
) &
  CardRevisionCommand;
export function renderExpertCardReview(): string {
  return `<section data-expert-card-root aria-labelledby="card-review-title"><h2 id="card-review-title">Карточки экспертов</h2><p>Защищённые материалы интервью доступны только в действующем сеансе сотрудника. Фото карточки открываются по защищённой временной ссылке после проверки сеанса.</p><button type="button" data-card-refresh disabled>Открыть / обновить очередь карточек</button><p data-card-status role="status" aria-live="polite">Для работы используйте административный сеанс выше.</p><button type="button" data-card-tag-export disabled>Экспорт каталога тегов</button><pre data-card-tag-export-result></pre><section data-card-queue aria-label="Очередь карточек"></section><section data-card-detail aria-label="Защищённый черновик"></section><fieldset><legend>Публичная профессиональная карточка</legend><p>Заполните только согласованное публичное описание, без контактов и ссылок. Приватные ответы автоматически не переносятся.</p><label>Отображаемое имя <input data-card-displayName maxlength="80" disabled></label><label>Профессия <input data-card-profession maxlength="120" disabled></label><label>Город <input data-card-city maxlength="80" disabled></label><label>Краткое описание одним абзацем <textarea data-card-summary maxlength="2000" rows="5" placeholder="TODO: Wait for Content Spec" disabled></textarea></label><button type="button" data-card-save disabled>Сохранить публичные поля</button></fieldset><label><input type="checkbox" data-card-warning-ack disabled> Я лично прочитал(а) текущие предупреждения и соответствующие поля.</label><button type="button" data-card-approve disabled>Утвердить текущую ревизию</button><label>Причина возврата <textarea data-card-return-reason maxlength="2000" disabled></textarea></label><button type="button" data-card-return disabled>Вернуть на доработку</button><button type="button" data-card-promo disabled>Подтвердить промо по текущим доказательствам</button><p>Подтверждение промо доступно только после реальной доставки материалов для утверждённой ревизии. Сотрудник не может отметить оплату, доставку или активацию вручную.</p></section>`;
}
export function bindExpertCardReview(
  root: HTMLElement,
  deps: {
    getClient: () => ExpertCardAdminClient | undefined;
    onUnauthorized: () => void;
    randomKey?: () => string;
  },
): { reset(): void; sync(): void; dispose(): void } {
  const el = <T extends HTMLElement>(name: string) =>
    root.querySelector<T>(`[data-card-${name}]`)!;
  const refresh = el<HTMLButtonElement>("refresh"),
    queue = el("queue"),
    detail = el("detail"),
    status = el("status"),
    save = el<HTMLButtonElement>("save"),
    approve = el<HTMLButtonElement>("approve"),
    back = el<HTMLButtonElement>("return"),
    promo = el<HTMLButtonElement>("promo");
  const fields = {
    displayName: el<HTMLInputElement>("displayName"),
    profession: el<HTMLInputElement>("profession"),
    city: el<HTMLInputElement>("city"),
    summary: el<HTMLTextAreaElement>("summary"),
  };
  const returnReason = root.querySelector<HTMLTextAreaElement>(
    "[data-card-return-reason]",
  );
  const warningAck = root.querySelector<HTMLInputElement>(
    "[data-card-warning-ack]",
  );
  const doc = root.ownerDocument,
    pending = new Map<string, Pending>();
  let selected: ExpertCardDraft | undefined,
    busy = false,
    generation = 0,
    active = true;
  const current = (client: ExpertCardAdminClient, epoch: number) =>
    active && epoch === generation && deps.getClient() === client;
  const text = (target: HTMLElement, value: string) => {
    const p = doc.createElement("p");
    p.textContent = value;
    target.append(p);
  };
  function promoEligible() {
    return (
      !!selected &&
      selected.status === "approved" &&
      !!selected.approvedReviewId &&
      selected.materialStatus === "delivered" &&
      selected.materials?.status === "delivered" &&
      !!selected.materials.contentVersion &&
      !selected.promoConfirmed &&
      selected.promoProofs.some(
        (p) =>
          (p.revision === selected!.revision &&
            p.reviewId === selected!.approvedReviewId) ||
          (p.revision === 0 && p.reviewId === null),
      )
    );
  }
  function controls() {
    const enabled = active && !!deps.getClient(),
      command = pending.get(selected?.applicationId ?? "");
    refresh.disabled = !enabled || busy;
    const exporter = el<HTMLButtonElement>("tag-export");
    if (exporter) exporter.disabled = !enabled || busy;
    for (const f of Object.values(fields))
      f.disabled = !enabled || busy || !selected || !!command;
    save.disabled =
      !enabled || busy || !selected || (!!command && command.kind !== "edit");
    const review = enabled && !busy && selected?.status === "manager_review";
    if (warningAck)
      warningAck.disabled = !review || !selected?.safety?.issues.length;
    approve.disabled =
      !review ||
      selected?.safety?.blocked === true ||
      !!selected?.semanticTags?.some(
        (t) => t.identity.startsWith("custom:") && t.decision !== "approve",
      ) ||
      (!!selected?.safety?.issues.length && !warningAck?.checked) ||
      !selected?.publicCard ||
      (!!command &&
        (command.kind !== "review" || command.action !== "approve"));
    if (returnReason) returnReason.disabled = !enabled || busy || !selected;
    back.disabled =
      !enabled ||
      busy ||
      !selected ||
      !["manager_review", "approved"].includes(selected.status) ||
      (!!command &&
        (command.kind !== "review" || command.action !== "return_changes"));
    promo.disabled =
      !enabled ||
      busy ||
      !promoEligible() ||
      (!!command && command.kind !== "promo");
  }
  function clear() {
    selected = undefined;
    if (returnReason) returnReason.value = "";
    if (warningAck) warningAck.checked = false;
    detail.replaceChildren();
    const exportView = el("tag-export-result");
    if (exportView) exportView.textContent = "";
    for (const f of Object.values(fields)) f.value = "";
    controls();
  }
  function reset() {
    generation++;
    busy = false;
    pending.clear();
    queue.replaceChildren();
    clear();
    status.textContent = "Защищённые данные карточек очищены.";
    controls();
  }
  function failed(error: unknown) {
    if (
      error instanceof Error &&
      error.message === "verification_unauthorized"
    ) {
      reset();
      deps.onUnauthorized();
      status.textContent = "Сеанс недействителен. Защищённые данные очищены.";
    } else if (
      error instanceof Error &&
      error.message.startsWith("card_safety_blocked:")
    ) {
      status.textContent = `Содержимое не сохранено. ${error.message.slice("card_safety_blocked:".length)}`;
      pending.delete(selected?.applicationId ?? "");
    } else
      status.textContent =
        error instanceof Error && error.message === "card_public_fields_invalid"
          ? "Проверьте публичные поля: обязательные значения, длину, отсутствие контактов и ссылок."
          : "Ответ не подтверждён. Повторите ту же операцию или обновите карточку.";
  }
  function render(item: ExpertCardDraft) {
    selected = item;
    if (warningAck) warningAck.checked = false;
    detail.replaceChildren();
    if (item.assistance?.requestedAt && !item.assistance.resolvedAt)
      text(
        detail,
        `Владелец просит помощи. Ревизия ${item.assistance.revision}, ${item.assistance.requestedAt}. Требуется ответ менеджера.`,
      );
    for (const tag of item.semanticTags ?? []) {
      text(
        detail,
        `${tag.label} — ${tag.identity.startsWith("custom:") ? ({ pending: "На модерации", approve: "Одобрен", reject: "Отклонён" }[tag.decision] ?? "На модерации") : "каталог"}${tag.reason ? ": " + tag.reason : ""}`,
      );
      if (!tag.identity.startsWith("custom:") || tag.decision !== "pending")
        continue;
      const reason = doc.createElement("input");
      reason.maxLength = 1000;
      reason.placeholder = "Причина решения о собственном теге";
      reason.setAttribute("aria-label", `Причина решения ${tag.label}`);
      detail.append(reason);
      for (const decision of ["approve", "reject"] as const) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent =
          decision === "approve"
            ? `Одобрить ${tag.label}`
            : `Отклонить ${tag.label}`;
        button.onclick = async () => {
          const client = deps.getClient(),
            epoch = generation;
          if (
            !client?.decideTag ||
            busy ||
            !active ||
            selected !== item ||
            !reason.value.trim()
          )
            return;
          busy = true;
          controls();
          try {
            await client.decideTag(item.applicationId, {
              expectedRevision: item.revision,
              idempotencyKey: crypto.randomUUID(),
              identity: tag.identity,
              decision,
              reason: reason.value.trim(),
            });
            if (!current(client, epoch)) return;
            const fresh = await client.read(item.applicationId);
            if (current(client, epoch) && selected === item) render(fresh);
          } catch (error) {
            if (current(client, epoch)) failed(error);
          } finally {
            if (current(client, epoch)) {
              busy = false;
              controls();
            }
          }
        };
        detail.append(button);
      }
    }
    if (item.rich?.enabled) {
      text(
        detail,
        item.rich.confirmed
          ? "Владелец подтвердил текущую версию."
          : "Нужно полное подтверждение владельца после любых правок.",
      );
      const container = doc.createElement("section");
      detail.append(container);
      const pages = richReadablePages({
        Профиль: item.rich.profile,
        "Подтверждённое расписание": item.rich.schedule ?? null,
        "Предложенные изменения": item.rich.proposal,
        "Предыдущая утверждённая версия": item.previousVersion ?? null,
      });
      let page = 0;
      const renderPage = () => {
        container.replaceChildren();
        text(
          container,
          `Профиль, услуги и предыдущая версия: страница ${page + 1}/${pages.length}`,
        );
        const pre = doc.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.textContent = pages[page]!;
        container.append(pre);
        for (const [label, delta] of [
          ["Назад", -1],
          ["Далее", 1],
        ] as const) {
          const b = doc.createElement("button");
          b.textContent = label;
          b.disabled = page + delta < 0 || page + delta >= pages.length;
          b.onclick = () => {
            page += delta;
            renderPage();
          };
          container.append(b);
        }
      };
      renderPage();
      if (item.previousVersion) {
        for (const [key, value] of Object.entries(item.rich.profile ?? {})) {
          const prior = item.previousVersion.profile?.[key];
          if (JSON.stringify(prior) !== JSON.stringify(value))
            text(detail, `Изменено: ${key}`);
        }
      }
      for (const [version, label, media] of [
        ["current", "Фото текущего черновика", item.media ?? []],
        [
          "approved",
          "Фото последней одобренной версии",
          item.previousMedia ?? [],
        ],
      ] as const) {
        text(detail, label);
        for (const [index, m] of media.entries()) {
          const b = doc.createElement("button");
          b.textContent = `Фото ${index + 1}${m.state === "verified" ? "" : " — недоступно"}`;
          b.setAttribute("data-card-media-id", m.id);
          b.setAttribute("data-card-media-version", version);
          b.disabled = m.state !== "verified";
          b.onclick = async () => {
            const c = deps.getClient(),
              epoch = generation,
              id = item.applicationId;
            if (!c?.mediaLink) return;
            try {
              const r = await c.mediaLink(id, m.id);
              if (!current(c, epoch) || selected?.applicationId !== id) return;
              const a = doc.createElement("a");
              a.href = r.url;
              a.textContent = "Открыть фото (ссылка действует 2 минуты)";
              a.rel = "noreferrer noopener";
              a.target = "_blank";
              b.replaceWith(a);
            } catch (e) {
              if (current(c, epoch) && selected?.applicationId === id)
                failed(e);
            }
          };
          detail.append(b);
        }
      }
    }
    if (item.returnReason)
      text(detail, `Причина возврата: ${item.returnReason}`);
    if (item.effectiveFields && !item.rich?.enabled) {
      text(detail, "Текущее содержимое для проверки:");
      for (const [field, value] of Object.entries(item.effectiveFields))
        text(detail, `${field}: ${value}`);
      text(
        detail,
        "История исходных ответов (заменённые ответы не участвуют в проверке):",
      );
    }
    for (const issue of item.safety?.issues ?? [])
      text(detail, `${issue.severity}: ${issue.field}: ${issue.reason}`);
    text(
      detail,
      `Карточка ${item.applicationId}. Ревизия ${item.revision}, этап: ${item.status}.`,
    );
    text(
      detail,
      "Приватные материалы интервью (не публикуются автоматически):",
    );
    for (const e of item.entries)
      text(
        detail,
        `${e.kind}, ревизия ${e.revision}: ${e.text ?? e.reference ?? ""}`,
      );
    text(
      detail,
      item.materialStatus === "waiting_content"
        ? "Материалы: TODO: Wait for Content Spec"
        : `Статус материалов: ${item.materialStatus}.`,
    );
    if (item.materials?.status === "unknown_outcome")
      text(
        detail,
        "Исход доставки неизвестен. Ручная отметка отправки или повторная отправка недоступны.",
      );
    for (const proof of item.promoProofs)
      text(
        detail,
        `Промо ${proof.kind}, ревизия ${proof.revision}: ${proof.reference}`,
      );
    text(
      detail,
      item.promoConfirmed
        ? "Промо подтверждено сервером для текущей карточки."
        : "Промо для текущей карточки не подтверждено.",
    );
    for (const k of Object.keys(fields) as (keyof ExpertPublicCard)[])
      fields[k].value = item.publicCard?.[k] ?? "";
    const command = pending.get(item.applicationId);
    if (
      command &&
      (item.revision !== command.expectedRevision ||
        (command.kind === "review" &&
          ((command.action === "approve" && item.status === "approved") ||
            (command.action === "return_changes" &&
              item.status === "changes_requested"))) ||
        (command.kind === "promo" && item.promoConfirmed))
    )
      pending.delete(item.applicationId);
    controls();
  }
  async function open(id: string) {
    const client = deps.getClient();
    if (!client || busy || !active) return;
    const epoch = generation;
    busy = true;
    clear();
    status.textContent = "Загружаем защищённую карточку…";
    controls();
    try {
      const item = await client.read(id);
      if (current(client, epoch)) {
        render(item);
        status.textContent =
          "Ревизия загружена. Публичные поля утверждает сотрудник.";
      }
    } catch (error) {
      if (current(client, epoch)) failed(error);
    } finally {
      if (current(client, epoch)) {
        busy = false;
        controls();
      }
    }
  }
  async function load() {
    const client = deps.getClient();
    if (!client || busy || !active) return;
    const epoch = generation;
    busy = true;
    clear();
    queue.replaceChildren();
    status.textContent = "Загружаем очередь карточек…";
    controls();
    try {
      const items = await client.list();
      if (!current(client, epoch)) return;
      for (const item of items) {
        const b = doc.createElement("button");
        b.type = "button";
        b.textContent = `${item.assistanceRequested ? "Нужна помощь · " : ""}${item.applicationId} · ревизия ${item.revision} · ${item.status} · материалов: ${item.entryCount}`;
        b.onclick = () => void open(item.applicationId);
        queue.append(b);
      }
      status.textContent = items.length
        ? `Карточек в загруженной очереди: ${items.length}.`
        : "Карточек для работы нет.";
    } catch (error) {
      if (current(client, epoch)) failed(error);
    } finally {
      if (current(client, epoch)) {
        busy = false;
        controls();
      }
    }
  }
  async function mutate(kind: "edit" | "approve" | "return_changes" | "promo") {
    const client = deps.getClient(),
      item = selected;
    if (!client || !item || busy || !active) return;
    const epoch = generation,
      id = item.applicationId;
    let command = pending.get(id);
    if (
      command &&
      !(
        (kind === "edit" && command.kind === "edit") ||
        (kind === "promo" && command.kind === "promo") ||
        ((kind === "approve" || kind === "return_changes") &&
          command.kind === "review" &&
          command.action === kind)
      )
    )
      return;
    try {
      if (!command) {
        const base = {
          expectedRevision: item.revision,
          idempotencyKey: (deps.randomKey ?? (() => crypto.randomUUID()))(),
        };
        if (kind === "edit") {
          const card = {
            displayName: fields.displayName.value.trim(),
            profession: fields.profession.value.trim(),
            city: fields.city.value.trim(),
            summary: fields.summary.value.trim(),
          };
          if (!validExpertPublicCard(card))
            throw new Error("card_public_fields_invalid");
          command = { ...base, kind: "edit", publicCard: card };
        } else if (kind === "promo") {
          if (!promoEligible()) return;
          command = { ...base, kind: "promo" };
        } else {
          if (
            ![
              "manager_review",
              ...(kind === "return_changes" ? ["approved"] : []),
            ].includes(item.status) ||
            (kind === "approve" && !item.publicCard)
          )
            return;
          if (
            kind === "approve" &&
            item.safety?.issues.length &&
            !warningAck?.checked
          )
            return;
          if (
            kind === "return_changes" &&
            item.rich?.enabled &&
            !returnReason?.value.trim()
          ) {
            status.textContent = "Укажите причину возврата.";
            return;
          }
          command = {
            ...base,
            kind: "review",
            action: kind,
            ...(kind === "return_changes" && returnReason?.value.trim()
              ? { returnReason: returnReason.value.trim() }
              : {}),
            ...(kind === "approve" && item.safety?.issues.length
              ? { warningAcknowledgment: item.safety.digest }
              : {}),
          };
        }
        pending.set(id, command);
      }
      busy = true;
      controls();
      status.textContent = "Сохраняем действие для выбранной ревизии…";
      const base = {
        expectedRevision: command.expectedRevision,
        idempotencyKey: command.idempotencyKey,
      };
      if (command.kind === "edit")
        await client.edit(id, { ...base, publicCard: command.publicCard });
      else if (command.kind === "review")
        await client.review(id, {
          ...base,
          action: command.action,
          ...(command.returnReason
            ? { returnReason: command.returnReason }
            : {}),
          ...(command.warningAcknowledgment
            ? { warningAcknowledgment: command.warningAcknowledgment }
            : {}),
        });
      else await client.confirmPromo(id, base);
      if (!current(client, epoch)) return;
      pending.delete(id);
      clear();
      const fresh = await client.read(id);
      if (current(client, epoch)) {
        render(fresh);
        status.textContent =
          "Действие сохранено. Отображается свежая серверная ревизия; оплата и доставка вручную не меняются.";
      }
    } catch (error) {
      if (current(client, epoch)) failed(error);
    } finally {
      if (current(client, epoch)) {
        busy = false;
        controls();
      }
    }
  }
  if (warningAck) warningAck.onchange = controls;
  const exporter = el<HTMLButtonElement>("tag-export"),
    exportResult = el("tag-export-result");
  if (exporter)
    exporter.onclick = async () => {
      const client = deps.getClient(),
        epoch = generation;
      if (!client?.exportTags || busy || !active) return;
      busy = true;
      controls();
      try {
        const value = await client.exportTags();
        if (current(client, epoch) && exportResult)
          exportResult.textContent = value;
      } catch (error) {
        if (current(client, epoch)) failed(error);
      } finally {
        if (current(client, epoch)) {
          busy = false;
          controls();
        }
      }
    };
  refresh.onclick = () => void load();
  save.onclick = () => void mutate("edit");
  approve.onclick = () => void mutate("approve");
  back.onclick = () => void mutate("return_changes");
  promo.onclick = () => void mutate("promo");
  controls();
  return {
    reset,
    sync: controls,
    dispose() {
      reset();
      active = false;
      if (warningAck) warningAck.onchange = null;
      refresh.onclick =
        save.onclick =
        approve.onclick =
        back.onclick =
        promo.onclick =
          null;
      controls();
    },
  };
}
