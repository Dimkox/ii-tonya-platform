export type ResidentWorkNoticeKind =
  "card_approved" | "card_returned" | "first_activation";
export type ResidentLifecycleCaseKind =
  | "materials_missing"
  | "promotion_overdue"
  | "main_payment_overdue"
  | "payment_reconciliation"
  | "quality_window"
  | "notice_unknown";
export interface ResidentLifecycleCase {
  id: string;
  applicationId: string | null;
  residentId: string;
  sourceId: string;
  kind: ResidentLifecycleCaseKind;
  status: "open" | "resolved" | "no_action";
  revision: number;
  createdAt: string;
  dueAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  numerator: number | null;
  denominator: number | null;
  missingProvenance: number | null;
  resolution: string | null;
  resolvedAt: string | null;
}
export interface ResidentLifecycleStaffRepository {
  listCases(sessionHash: string): Promise<ResidentLifecycleCase[]>;
  readCase(
    sessionHash: string,
    id: string,
  ): Promise<ResidentLifecycleCase | null>;
  closeCase(input: {
    sessionHash: string;
    id: string;
    expectedRevision: number;
    idempotencyKey: string;
    resolution: string;
  }): Promise<{ replay: boolean }>;
}
export type ResidentWorkOutcome =
  | {
      kind: "applied";
      receipt: { botKey: string; chatId: string; messageId: number };
    }
  | { kind: "not_applied"; retryAfterSeconds?: number }
  | { kind: "unknown" | "failed"; pauseBot?: boolean; reasonCode: string };
export interface ResidentWorkTransport {
  send(input: {
    botKey: string;
    chatId: string;
    text: string;
    deadline: string;
  }): Promise<ResidentWorkOutcome>;
}
export function qualityNeedsReview(
  numerator: number,
  denominator: number,
): boolean {
  if (
    ![numerator, denominator].every((v) => Number.isSafeInteger(v) && v >= 0) ||
    numerator > denominator
  )
    throw new Error("resident_quality_counts_invalid");
  return (
    denominator > 0 && BigInt(numerator) * 100n > BigInt(denominator) * 20n
  );
}
export function renderResidentWorkNotice(
  kind: ResidentWorkNoticeKind,
  reason: string | null,
  previouslyPublished: boolean,
): string {
  if (kind === "card_returned") {
    if (!reason || reason.length > 2000 || !reason.isWellFormed())
      throw new Error("resident_return_reason_required");
    return `Карточка возвращена на доработку. Причина: ${reason}\nОткройте /card, внесите изменения и отправьте карточку повторно.${previouslyPublished ? " Ранее опубликованная версия сохраняется при действующих условиях резидентства." : ""}`;
  }
  if (kind === "card_approved")
    return `Ваша карточка проверена и утверждена менеджером.${previouslyPublished ? " Обновление согласовано." : " Следующий шаг — размещение анонсов после получения материалов и подтверждение публикаций."}\nТекущее состояние — /card. Материалы — /materials.`;
  return "Вы стали активным резидентом! Ваша карточка доступна клиентам при действующих условиях резидентства.\nЗаявки: подтверждайте или отклоняйте их кнопками в уведомлении. Расписание — /schedule.\nПрофиль и услуги: /card; изменения проходят вашу проверку и проверку менеджера. Свободные слоты обновляются после подтверждения расписания: /slots_setup и /slots_preview. Чтобы закрыть свободное время: /slots_busy YYYY-MM-DD HH:MM-HH:MM. Уже подтверждённые записи сохраняются.\nАдрес подтверждённой встречи клиент получает отдельно, ссылку онлайн-встречи — незадолго до начала. При нестандартной ситуации обратитесь к менеджеру.\nПауза — /pause YYYY-MM-DD, возврат — /resume. Оплаченный календарный период продолжается во время паузы.";
}
