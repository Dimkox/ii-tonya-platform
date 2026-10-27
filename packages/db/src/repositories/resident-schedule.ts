import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  generateSchedule,
  importSchedule,
  scheduleRulesSchema,
  scheduleTimezones,
  richReadablePages,
  resolveScheduleTime,
  type ScheduleRules,
  type RichProfile,
  type SchedulePreview,
} from "@ii-tonya/contracts";
import type { ExpertCardTransaction } from "./expert-card-repository.js";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const questions = [
  "Выберите часовой пояс по номеру:\n" +
    scheduleTimezones.map((z, i) => `${i + 1}. ${z.label}`).join("\n") +
    "\nИли укажите IANA, например Europe/Berlin. Пояс не определяется автоматически.",
  "Какие даты включить? От 1 до 31 дня, явно: 2026-11-01 2026-11-30.",
  "Рабочие дни: номера через пробел, 1 — понедельник, 7 — воскресенье.",
  "Рабочее время: 09:00-18:00. Встреча вместе с буфером должна помещаться целиком.",
  "Перерывы: 13:00-14:00, 16:00-16:15 либо «нет».",
  "Буфер между встречами: целое число минут от 0 до 240.",
];
interface State extends Record<string, unknown> {
  rules: Partial<ScheduleRules>;
  mode: string;
  field: number;
  revision: number;
  currentPreview: string | null;
  raw: string | null;
}
interface PreviewRow extends Record<string, unknown> {
  id: string;
  draftRevision: number;
  scheduleRevision: number;
  reviewId: string | null;
  digest: string;
  rules: ScheduleRules;
  entries: SchedulePreview["slots"];
  omissions: string[];
  errors: SchedulePreview["errors"];
  page: number;
  pageCount: number;
  token: string | null;
  confirmed: string | null;
  expired: boolean;
}
export async function ownerSchedule(
  tx: ExpertCardTransaction,
  draft: { id: string; revision: number; status: string },
  text: string,
): Promise<string> {
  await tx.execute(
    sql`insert into resident_schedule_state(draft_id) values(${draft.id}::uuid) on conflict do nothing`,
  );
  if (text === "/slots_card")
    await tx.execute(
      sql`update resident_schedule_state set mode='card' where draft_id=${draft.id}::uuid`,
    );
  if (text === "/slots_setup" || text === "Обновить слоты")
    await tx.execute(
      sql`update resident_schedule_state set mode='live' where draft_id=${draft.id}::uuid`,
    );
  const source = (
    await tx.execute<{
      profile: RichProfile | null;
      reviewId: string | null;
      digest: string;
      expertId: string | null;
    }>(
      sql`select coalesce(v.profile,d.rich_profile) as profile,v.review_id as "reviewId",encode(digest(coalesce(v.profile,d.rich_profile)::text,'sha256'),'hex') as digest,e.id as "expertId" from expert_card_drafts d left join lateral(select review_id,profile from resident_card_versions where draft_id=d.id and (select mode from resident_schedule_state where draft_id=d.id)='live' order by revision desc limit 1) v on true left join experts e on e.user_id=d.user_id where d.id=${draft.id}::uuid`,
    )
  ).rows[0]!;
  await tx.execute(
    sql`insert into resident_schedule_state(draft_id) values(${draft.id}::uuid) on conflict do nothing`,
  );
  const state = (
    await tx.execute<State>(
      sql`select rules,mode,field,revision,current_preview as "currentPreview",raw_input as raw from resident_schedule_state where draft_id=${draft.id}::uuid for update`,
    )
  ).rows[0]!;
  const save = async (
    rules: Partial<ScheduleRules>,
    field: number,
    raw: string | null = null,
  ) => {
    if (!source.reviewId) {
      if (draft.status === "manager_review")
        throw Error("Карточка уже на проверке; дождитесь решения менеджера");
      await tx.execute(
        sql`update expert_card_drafts set initial_schedule=null,revision=revision+1,status='collecting',approved_review_id=null where id=${draft.id}::uuid`,
      );
    }
    await tx.execute(
      sql`update resident_schedule_state set rules=${JSON.stringify(rules)}::jsonb,field=${field},revision=revision+1,raw_input=${raw},current_preview=null,updated_at=clock_timestamp() where draft_id=${draft.id}::uuid`,
    );
  };
  const question = (n: number) =>
    questions[n]! + "\nОтвет: /slots_answer ваш ответ";
  if (
    text === "/slots_setup" ||
    text === "/slots_card" ||
    text === "Обновить слоты"
  ) {
    await save({}, 0);
    return question(0);
  }
  if (text.startsWith("/slots_answer ")) {
    if (state.field >= 6)
      return "График заполнен. /slots_preview — полный просмотр; /slots_import — импорт; /slots_setup — изменить параметры.";
    const answer = text.slice(14).trim(),
      rules = { ...state.rules };
    switch (state.field) {
      case 0: {
        const timezone = /^\d{1,2}$/u.test(answer)
          ? scheduleTimezones[Number(answer) - 1]?.zone
          : answer;
        if (!timezone) throw Error("Выберите часовой пояс");
        rules.timezone = scheduleRulesSchema.shape.timezone.parse(timezone);
        break;
      }
      case 1: {
        const m = /^(20\d{2}-\d{2}-\d{2}) (20\d{2}-\d{2}-\d{2})$/u.exec(answer);
        if (!m) throw Error("Укажите две даты: 2026-11-01 2026-11-30");
        rules.from = m[1]!;
        rules.to = m[2]!;
        break;
      }
      case 2:
        if (!/^[1-7](?: [1-7]){0,6}$/u.test(answer))
          throw Error("Дни: 1 2 3 4 5");
        else rules.weekdays = answer.split(" ").map((v) => Number(v) - 1);
        break;
      case 3: {
        const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/u.exec(answer);
        if (!m) throw Error("Рабочее время: 09:00-18:00");
        rules.start = m[1]!;
        rules.end = m[2]!;
        break;
      }
      case 4:
        rules.breaks =
          answer.toLowerCase() === "нет"
            ? []
            : answer.split(",").map((v) => {
                const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/u.exec(v.trim());
                if (!m) throw Error("Перерывы: 13:00-14:00 либо нет");
                return { start: m[1]!, end: m[2]! };
              });
        break;
      case 5:
        if (!/^\d{1,3}$/u.test(answer))
          throw Error("Укажите целое число минут");
        rules.bufferMinutes = Number(answer);
        scheduleRulesSchema.parse(rules);
        break;
    }
    await save(rules, state.field + 1);
    return state.field < 5
      ? question(state.field + 1)
      : "График сохранён приватно. /slots_preview — сгенерировать и просмотреть все слоты. /slots_import и список строк — ручной импорт вместо генерации. Публикация только после подтверждения.";
  }
  const services = source.profile?.services;
  if (!services?.length)
    return "Сначала добавьте услуги и длительность через /card_mode. Расписание можно подготовить до проверки менеджером.";
  if (text.startsWith("/slots_import")) {
    if (!text.includes("\n") && text === "/slots_import")
      return (
        "Пришлите /slots_import и со следующей строки список YYYY-MM-DD HH:MM-HH:MM Название услуги либо CSV дата,начало,конец,услуга. Услуги: " +
        services
          .map((s) => `${s.title} (${s.durationMinutes} мин; id:${s.id})`)
          .join("; ")
      );
    const raw = text.slice(13).trim();
    importSchedule(raw, state.rules, services);
    await save(state.rules, state.field, raw);
    return "Импорт сохранён приватно. /slots_preview — проверить каждую строку и ошибки перед применением.";
  }
  if (text.startsWith("/slots_busy ") || text.startsWith("Убери слот ")) {
    if (!source.expertId || !source.reviewId)
      return "Занятое время можно отметить после утверждения услуг.";
    const m = /(20\d{2}-\d{2}-\d{2}) (\d{2}:\d{2})-(\d{2}:\d{2})$/u.exec(text);
    if (!m || !state.rules.timezone)
      throw Error(
        "Укажите /slots_busy YYYY-MM-DD HH:MM-HH:MM после выбора часового пояса.",
      );
    const start = resolveScheduleTime(`${m[1]}T${m[2]}`, state.rules.timezone),
      end = resolveScheduleTime(`${m[1]}T${m[3]}`, state.rules.timezone);
    if (
      !state.rules.from ||
      !state.rules.to ||
      m[1]! < state.rules.from ||
      m[1]! > state.rules.to
    )
      throw Error(
        "Занятое время должно входить в подтверждаемый период расписания",
      );
    if (start >= end) throw Error("Начало раньше окончания");
    await tx.execute(
      sql`select id from experts where id=${source.expertId}::uuid for update`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${"expert:" + source.expertId},0))`,
    );
    const conflicts = (
      await tx.execute<{ n: number }>(
        sql`select count(*)::int n from reservations r join slots s on s.id=r.slot_id left join resident_native_slots n on n.slot_id=s.id where r.expert_id=${source.expertId}::uuid and r.status in('reserved','booked') and s.starts_at<${end}::timestamptz and coalesce(n.occupied_until,s.ends_at)>${start}::timestamptz`,
      )
    ).rows[0]!.n;
    if (
      (
        await tx.execute<{ n: number }>(
          sql`select count(*)::int n from resident_schedule_busy where draft_id=${draft.id}::uuid and ends_at>clock_timestamp()`,
        )
      ).rows[0]!.n >= 500
    )
      throw Error("Не более 500 будущих занятых интервалов");
    await tx.execute(
      sql`insert into resident_schedule_busy(expert_id,draft_id,starts_at,ends_at) values(${source.expertId}::uuid,${draft.id}::uuid,${start}::timestamptz,${end}::timestamptz)`,
    );
    await tx.execute(
      sql`update resident_native_slots n set withdrawn_at=clock_timestamp() from slots s join expert_services es on es.id=s.expert_service_id where n.slot_id=s.id and es.expert_id=${source.expertId}::uuid and n.withdrawn_at is null and s.starts_at<${end}::timestamptz and n.occupied_until>${start}::timestamptz and not exists(select 1 from reservations r where r.slot_id=s.id and r.status in('reserved','booked'))`,
    );
    return `Время отмечено занятым. Существующих заявок/встреч: ${conflicts}; они сохранены, при необходимости свяжитесь с клиентами. Внешний календарь не изменялся.`;
  }
  if (text === "/slots_preview") {
    const rules = scheduleRulesSchema.parse(state.rules);
    const preview =
      state.raw === null
        ? generateSchedule(rules, services)
        : importSchedule(state.raw, rules, services);
    if (source.expertId) {
      const conflicts = (
        await tx.execute<{ startsAt: string; endsAt: string }>(
          sql`select s.starts_at::text as "startsAt",coalesce(n.occupied_until,s.ends_at)::text as "endsAt" from reservations r join slots s on s.id=r.slot_id left join resident_native_slots n on n.slot_id=s.id where r.expert_id=${source.expertId}::uuid and r.status in('reserved','booked') and s.starts_at<(${rules.to}::date+1)::timestamp at time zone ${rules.timezone} and s.ends_at>=${rules.from}::date::timestamp at time zone ${rules.timezone} union all select b.starts_at::text,b.ends_at::text from resident_schedule_busy b where b.expert_id=${source.expertId}::uuid and b.ends_at>clock_timestamp() order by "startsAt"`,
        )
      ).rows;
      preview.omissions.push(
        ...conflicts.map(
          (c) =>
            `Сохранена существующая заявка/встреча или занятое время: ${c.startsAt} — ${c.endsAt}. Пересекающиеся предложения будут пропущены.`,
        ),
      );
      const overlaps = (s: SchedulePreview["slots"][number]) =>
        conflicts.some(
          (c) =>
            +new Date(c.startsAt) < +new Date(s.occupiedUntil) &&
            +new Date(c.endsAt) > +new Date(s.startsAt),
        );
      if (state.raw !== null)
        preview.slots.forEach((s, i) => {
          if (overlaps(s))
            preview.errors.push({
              row: i + 1,
              message:
                "Пересечение с существующей заявкой/встречей; строка не может быть применена",
            });
        });
      else preview.slots = preview.slots.filter((s) => !overlaps(s));
    }
    const databaseNow = (
      await tx.execute<{ now: Date | string }>(
        sql`select clock_timestamp() as now`,
      )
    ).rows[0]!.now;
    if (
      preview.slots.some(
        (slot) => Date.parse(slot.startsAt) <= +new Date(databaseNow),
      )
    )
      preview.errors.push({
        row: 0,
        message:
          "Некоторые интервалы уже прошли. Выберите будущие даты и откройте новый просмотр.",
      });
    const pages = schedulePages(rules, preview);
    const p = (
      await tx.execute<{ id: string }>(
        sql`insert into resident_schedule_previews(draft_id,schedule_revision,draft_revision,review_id,raw_input,profile_digest,rules,entries,omissions,errors,page_count) values(${draft.id}::uuid,${state.revision},${draft.revision},${source.reviewId}::uuid,${state.raw},${source.digest},${JSON.stringify(rules)}::jsonb,${JSON.stringify(preview.slots)}::jsonb,${JSON.stringify(preview.omissions)}::jsonb,${JSON.stringify(preview.errors)}::jsonb,${pages.length}) returning id`,
      )
    ).rows[0]!;
    await tx.execute(
      sql`update resident_schedule_state set current_preview=${p.id}::uuid where draft_id=${draft.id}::uuid`,
    );
    state.currentPreview = p.id;
    return display(0);
  }
  const page = /^\/slots_page (\d{1,3}) ([0-9a-f-]{36})$/u.exec(text),
    confirm = /^\/slots_confirm ([0-9a-f-]{36})$/u.exec(text);
  if (page || confirm)
    return display(page ? Number(page[1]) : -1, page?.[2] ?? confirm?.[1]);
  return "Расписание: /slots_setup — утверждённые услуги; /slots_card — расписание для новой проверки карточки; /slots_import — импорт; /slots_preview — все страницы и подтверждение; /slots_busy YYYY-MM-DD HH:MM-HH:MM — занятое время. /schedule по-прежнему показывает встречи.";
  async function display(page: number, token?: string): Promise<string> {
    if (!state.currentPreview) throw Error("Откройте новый /slots_preview");
    const p = (
      await tx.execute<PreviewRow>(
        sql`select id,draft_revision as "draftRevision",schedule_revision as "scheduleRevision",review_id as "reviewId",profile_digest as digest,rules,entries,omissions,errors,page,page_count as "pageCount",token_digest as token,confirmed_at as confirmed,expires_at<=clock_timestamp() as expired from resident_schedule_previews where id=${state.currentPreview}::uuid and draft_id=${draft.id}::uuid for update`,
      )
    ).rows[0];
    if (
      !p ||
      p.confirmed ||
      p.expired ||
      p.digest !== source.digest ||
      p.reviewId !== source.reviewId ||
      p.draftRevision !== draft.revision ||
      p.scheduleRevision !== state.revision
    )
      throw Error(
        "Версия изменилась или устарела. Откройте новый /slots_preview",
      );
    const pages = schedulePages(p.rules, {
      slots: p.entries,
      errors: p.errors,
      omissions: p.omissions,
      committable: p.errors.length === 0,
    });
    if (page === -1) {
      if (
        !token ||
        sha(token) !== p.token ||
        p.page !== pages.length - 1 ||
        p.errors.length
      )
        throw Error("Просмотрите все страницы и исправьте ошибки");
      await tx.execute(
        sql`update resident_schedule_previews set confirmed_at=clock_timestamp() where id=${p.id}::uuid`,
      );
      if (source.reviewId) {
        if (
          !(
            await tx.execute<{ allowed: boolean }>(
              sql`select resident_native_admission(${source.expertId}::uuid) as allowed`,
            )
          ).rows[0]?.allowed
        )
          throw Error(
            "Новые слоты доступны только при действующем размещении и согласии",
          );
        await tx.execute(
          sql`select resident_apply_schedule(${p.id}::uuid,${source.reviewId}::uuid)`,
        );
        return "Расписание подтверждено и обновлено. Существующие заявки и встречи сохранены. Проверка карточки заново не требуется.";
      }
      if (draft.status === "manager_review")
        throw Error("Карточка уже на проверке; дождитесь решения менеджера");
      await tx.execute(
        sql`update expert_card_drafts set initial_schedule=jsonb_build_object('previewId',${p.id}::uuid,'rules',${JSON.stringify(p.rules)}::jsonb,'entries',${JSON.stringify(p.entries)}::jsonb,'omissions',${JSON.stringify(p.omissions)}::jsonb),revision=revision+1,status='collecting',approved_review_id=null where id=${draft.id}::uuid`,
      );
      return "Расписание сохранено приватно. Откройте /card_preview: подтвердите полную карточку с расписанием для менеджера. Клиентам оно пока не доступно.";
    }
    if (
      page < 0 ||
      page >= pages.length ||
      (page > 0 && (p.page !== page - 1 || !token || sha(token) !== p.token))
    )
      throw Error("Откройте страницы по порядку через /slots_preview");
    const next = randomUUID();
    await tx.execute(
      sql`update resident_schedule_previews set page=${page},token_digest=${sha(next)} where id=${p.id}::uuid`,
    );
    return `Расписание. Страница ${page + 1}/${pages.length}\n${pages[page]}\n${page + 1 < pages.length ? `/slots_page ${page + 1} ${next}` : p.errors.length ? "Исправьте строки и создайте новый просмотр." : `/slots_confirm ${next}`}`;
  }
}
function schedulePages(rules: ScheduleRules, p: SchedulePreview): string[] {
  return richReadablePages({
    Параметры: rules,
    "Слоты (местное время и UTC)": p.slots.map(
      (s) =>
        `${s.title}: ${s.localStart} — ${s.localEnd}, ${s.timezone}; UTC ${s.startsAt} — ${s.endsAt}; буфер ${s.bufferMinutes} мин, занят до ${s.occupiedUntil}`,
    ),
    "Пропуски и сохранённые встречи": p.omissions,
    "Ошибки строк": p.errors,
  });
}
