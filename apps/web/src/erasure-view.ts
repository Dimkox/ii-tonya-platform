import { PrivacyClient, type ErasureProgress } from "./privacy-client.js";

export const erasureMarkup =
  () => `<section aria-label="Удаление данных" data-erasure>
  <h2>Удаление данных</h2>
  <p>Запрос не означает завершённое удаление. Обработчики и резервные копии проверяются отдельно. Финансовые и аудиторские факты могут сохраняться.</p>
  <button type="button" data-erasure-prepare disabled>Подготовить запрос удаления</button>
  <div data-erasure-confirm hidden><p>Сохрани ключ статуса до отправки. Он позволяет только проверить удаление, действует до отзыва и не восстанавливается при потере. Не передавай его другим. После выполнения запроса вход в аккаунт будет закрыт.</p>
    <button type="button" data-erasure-download>Скачать ключ статуса</button>
    <label><input type="checkbox" data-erasure-saved> Я сохранил ключ и подтверждаю запрос удаления</label>
    <button type="button" data-erasure-send disabled>Подтвердить запрос удаления</button>
  </div>
  <button type="button" data-erasure-owned disabled>Проверить запрос моего аккаунта</button>
  <label>Ключ статуса <input type="password" data-erasure-token autocomplete="off" spellcheck="false" maxlength="47"></label>
  <button type="button" data-erasure-read>Проверить по ключу</button>
  <p role="status" aria-live="polite" data-erasure-progress></p>
</section>`;
const stages: Record<ErasureProgress["stage"], string> = {
  awaiting_execution:
    "Запрос принят. Ожидаем проверенные условия выполнения. Удаление ещё не завершено.",
  deleting: "Удаление выполняется. Завершение ещё не подтверждено.",
  awaiting_backup:
    "Обработка завершена. Ожидаем подтверждение удаления резервных копий.",
  needs_attention: "Для продолжения удаления требуется проверка оператором.",
  completed: "Удаление подтверждено проверенным процессом.",
};
export function bindErasureActions(root: ParentNode, client: PrivacyClient) {
  const button = (key: string) =>
    root.querySelector<HTMLButtonElement>(`[data-erasure-${key}]`)!;
  const progress = root.querySelector<HTMLElement>("[data-erasure-progress]")!;
  const confirm = root.querySelector<HTMLElement>("[data-erasure-confirm]")!;
  const saved = root.querySelector<HTMLInputElement>("[data-erasure-saved]")!;
  const input = root.querySelector<HTMLInputElement>("[data-erasure-token]")!;
  let receipt = "";
  let downloaded = false;
  let busy = false;
  const show = (value: ErasureProgress) => {
    const label = stages[value.stage];
    if (!label) throw new Error("invalid_progress");
    progress.textContent =
      label +
      (value.retainedFacts
        ? ` Сохранены финансовые факты: ${value.retainedFacts.ledgerFactsPreserved}; аудиторские факты: ${value.retainedFacts.auditFactsPreserved}.`
        : "");
  };
  const run = async (action: () => Promise<ErasureProgress>) => {
    if (busy) return;
    busy = true;
    button("send").disabled = true;
    try {
      show(await action());
    } catch {
      progress.textContent =
        "Результат не подтверждён. Проверь статус по сохранённому ключу. Повторная отправка в этой вкладке использует тот же ключ; не создавай новый запрос после неопределённого ответа.";
    } finally {
      busy = false;
      button("send").disabled = !receipt || !downloaded || !saved.checked;
    }
  };
  button("prepare").onclick = () => {
    try {
      receipt = client.prepareErasureReceipt();
      confirm.hidden = false;
    } catch {
      progress.textContent =
        "Создание запроса сейчас недоступно. Проверка по сохранённому ключу остаётся доступной.";
    }
  };
  button("download").onclick = () => {
    if (!receipt) return;
    const url = URL.createObjectURL(
      new Blob([receipt], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "erasure-status-key.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    downloaded = true;
    button("send").disabled = busy || !saved.checked;
  };
  saved.onchange = () => {
    button("send").disabled = busy || !downloaded || !saved.checked;
  };
  button("send").onclick = () => {
    if (receipt && downloaded && saved.checked)
      void run(() => client.requestErasure());
  };
  button("owned").onclick = () => {
    void run(() => client.readOwnedErasure());
  };
  button("read").onclick = () => {
    const token = input.value;
    input.value = "";
    void run(() => client.readErasureReceipt(token));
  };
  const reset = () => {
    receipt = "";
    downloaded = false;
    saved.checked = false;
    confirm.hidden = true;
    button("prepare").disabled = true;
    button("owned").disabled = true;
    button("send").disabled = true;
    progress.textContent = "";
  };
  client.onAuthorityChange(reset);
  window.addEventListener("pagehide", () => {
    reset();
    input.value = "";
  });
  return (available: boolean) => {
    button("prepare").disabled = !client.authenticated || !available;
    button("owned").disabled = !client.authenticated;
  };
}
