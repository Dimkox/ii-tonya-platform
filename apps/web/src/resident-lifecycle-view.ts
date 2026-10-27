import type { ResidentLifecycleCase } from "../../../packages/contracts/src/resident-lifecycle-completion.js";
import type { ExpertCardAdminClient } from "./expert-card-client.js";
const labels: Record<ResidentLifecycleCase["kind"], string> = {
  materials_missing: "Материалы пока не выданы — внутренняя задача",
  promotion_overdue: "Ожидается подтверждение публикации",
  main_payment_overdue: "Ожидается основной платёж",
  payment_reconciliation: "Требуется проверить неопределённый платёж",
  quality_window: "Частые отказы — проверить расписание",
  notice_unknown: "Неопределённая доставка уведомления",
};
export function renderResidentLifecycleReview(): string {
  return '<section data-lifecycle-root aria-labelledby="resident-lifecycle-title"><h3 id="resident-lifecycle-title">Сопровождение резидентов</h3><p>Сроки онбординга и сигналы качества требуют проверки сотрудником. Закрытие обращения не изменяет оплату, доступ или результат доставки.</p><button type="button" data-lifecycle-refresh disabled>Обновить обращения</button><p data-lifecycle-status role="status" aria-live="polite"></p><div data-lifecycle-list></div><div data-lifecycle-detail></div><label>Результат проверки <textarea data-lifecycle-resolution maxlength="2000" disabled></textarea></label><button type="button" data-lifecycle-close disabled>Проверено — закрыть обращение</button></section>';
}
export function bindResidentLifecycleReview(
  root: HTMLElement,
  deps: {
    getClient: () => ExpertCardAdminClient | undefined;
    onUnauthorized: () => void;
    randomKey?: () => string;
  },
) {
  const button = root.querySelector<HTMLButtonElement>(
      "[data-lifecycle-refresh]",
    ),
    close = root.querySelector<HTMLButtonElement>("[data-lifecycle-close]"),
    status = root.querySelector<HTMLElement>("[data-lifecycle-status]"),
    list = root.querySelector<HTMLElement>("[data-lifecycle-list]"),
    detail = root.querySelector<HTMLElement>("[data-lifecycle-detail]"),
    resolution = root.querySelector<HTMLTextAreaElement>(
      "[data-lifecycle-resolution]",
    );
  if (!button || !close || !status || !list || !detail || !resolution)
    return { reset() {}, sync() {}, dispose() {} };
  let epoch = 0,
    busy = false,
    mounted = true,
    selected: ResidentLifecycleCase | undefined,
    pending:
      | {
          id: string;
          expectedRevision: number;
          idempotencyKey: string;
          resolution: string;
        }
      | undefined;
  const current = (client: ExpertCardAdminClient, generation: number) =>
    mounted && deps.getClient() === client && epoch === generation;
  const sync = () => {
    const enabled = mounted && !!deps.getClient()?.lifecycle;
    button.disabled = !enabled || busy;
    resolution.disabled = !enabled || busy || !selected || !!pending;
    close.disabled =
      !enabled ||
      busy ||
      !selected ||
      selected.status !== "open" ||
      (!pending && !resolution.value.trim());
  };
  const reset = () => {
    epoch++;
    busy = false;
    selected = undefined;
    pending = undefined;
    list.replaceChildren();
    detail.replaceChildren();
    resolution.value = "";
    status.textContent = "";
    sync();
  };
  const failed = (error: unknown) => {
    if (
      error instanceof Error &&
      /unauthorized|forbidden/u.test(error.message)
    ) {
      reset();
      deps.onUnauthorized();
    } else
      status.textContent =
        error instanceof Error && /conflict/u.test(error.message)
          ? "Обращение изменилось. Обновите список."
          : "Не удалось выполнить действие. Можно повторить запрос.";
  };
  const show = (item: ResidentLifecycleCase) => {
    selected = item;
    pending = undefined;
    detail.replaceChildren();
    resolution.value = "";
    const p = root.ownerDocument.createElement("p");
    p.textContent = `${labels[item.kind]}. Обращение ${item.id}. Резидент ${item.residentId}. Источник ${item.sourceId}.${item.applicationId ? ` Заявка ${item.applicationId}.` : ""}${item.dueAt ? ` Срок: ${new Date(item.dueAt).toISOString()}.` : ""}${item.kind === "quality_window" ? ` Отказы эксперта: ${item.numerator}; завершённые или подтверждённые заявки: ${item.denominator}. Окно UTC: ${item.windowStart} — ${item.windowEnd}. Без подтверждённого происхождения: ${item.missingProvenance}. Это сигнал для проверки, автоматической блокировки нет.` : ""}`;
    detail.append(p);
    sync();
  };
  button.onclick = async () => {
    const client = deps.getClient(),
      generation = epoch;
    if (!client?.lifecycle || busy || !mounted) return;
    busy = true;
    sync();
    status.textContent = "Загружаем обращения…";
    try {
      const rows = await client.lifecycle.list();
      if (!current(client, generation)) return;
      list.replaceChildren();
      detail.replaceChildren();
      selected = undefined;
      pending = undefined;
      for (const row of rows) {
        const b = root.ownerDocument.createElement("button");
        b.type = "button";
        b.textContent = labels[row.kind];
        b.onclick = async () => {
          if (busy || !current(client, generation)) return;
          busy = true;
          sync();
          try {
            const item = await client.lifecycle!.read(row.id);
            if (current(client, generation)) show(item);
          } catch (e) {
            if (current(client, generation)) failed(e);
          } finally {
            if (current(client, generation)) {
              busy = false;
              sync();
            }
          }
        };
        list.append(b);
      }
      status.textContent = rows.length
        ? `Открытых обращений: ${rows.length}`
        : "Открытых обращений нет.";
    } catch (e) {
      if (current(client, generation)) failed(e);
    } finally {
      if (current(client, generation)) {
        busy = false;
        sync();
      }
    }
  };
  close.onclick = async () => {
    const client = deps.getClient(),
      generation = epoch;
    if (!client?.lifecycle || !selected || busy || !mounted) return;
    pending ??= {
      id: selected.id,
      expectedRevision: selected.revision,
      idempotencyKey: deps.randomKey?.() ?? crypto.randomUUID(),
      resolution: resolution.value.trim(),
    };
    const command = pending;
    busy = true;
    sync();
    try {
      await client.lifecycle.close(command.id, {
        expectedRevision: command.expectedRevision,
        idempotencyKey: command.idempotencyKey,
        resolution: command.resolution,
      });
      const fresh = await client.lifecycle.read(command.id);
      if (current(client, generation)) {
        pending = undefined;
        show(fresh);
        status.textContent =
          "Результат проверки сохранён. Оплата и доступ не изменены.";
      }
    } catch (e) {
      if (current(client, generation)) failed(e);
    } finally {
      if (current(client, generation)) {
        busy = false;
        sync();
      }
    }
  };
  resolution.oninput = sync;
  sync();
  return {
    reset,
    sync,
    dispose() {
      reset();
      mounted = false;
      button.onclick = null;
      close.onclick = null;
      resolution.oninput = null;
      sync();
    },
  };
}
