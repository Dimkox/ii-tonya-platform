import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const day = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/u)
  .refine((v) => {
    try {
      return (
        Temporal.PlainDate.from(v, { overflow: "reject" }).toString() === v
      );
    } catch {
      return false;
    }
  });
const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
const hhmm = (v: number) =>
  `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
export const scheduleTimezones = [
  { zone: "Europe/Kaliningrad", label: "Калининград — UTC+02:00" },
  { zone: "Europe/Moscow", label: "Москва — UTC+03:00" },
  { zone: "Europe/Samara", label: "Самара — UTC+04:00" },
  { zone: "Asia/Yekaterinburg", label: "Екатеринбург — UTC+05:00" },
  { zone: "Asia/Omsk", label: "Омск — UTC+06:00" },
  { zone: "Asia/Novosibirsk", label: "Новосибирск — UTC+07:00" },
  { zone: "Asia/Irkutsk", label: "Иркутск — UTC+08:00" },
  { zone: "Asia/Yakutsk", label: "Якутск — UTC+09:00" },
  { zone: "Asia/Vladivostok", label: "Владивосток — UTC+10:00" },
  { zone: "Asia/Magadan", label: "Магадан — UTC+11:00" },
  { zone: "Asia/Kamchatka", label: "Петропавловск-Камчатский — UTC+12:00" },
] as const;
export const scheduleRulesSchema = z
  .strictObject({
    timezone: z
      .string()
      .max(80)
      .refine((v) => {
        if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/u.test(v)) return false;
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Выберите часовой пояс IANA"),
    from: day,
    to: day,
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    start: clock,
    end: clock,
    breaks: z.array(z.strictObject({ start: clock, end: clock })).max(8),
    bufferMinutes: z.number().int().min(0).max(240),
  })
  .superRefine((r, ctx) => {
    try {
      const span = Temporal.PlainDate.from(r.from).until(
        Temporal.PlainDate.from(r.to),
      ).days;
      if (span < 0 || span > 30)
        ctx.addIssue({ code: "custom", message: "Период от 1 до 31 дня" });
    } catch {
      ctx.addIssue({ code: "custom", message: "Проверьте даты" });
    }
    if (r.start >= r.end)
      ctx.addIssue({ code: "custom", message: "Начало раньше окончания" });
    const breaks = [...r.breaks].sort((a, b) => a.start.localeCompare(b.start));
    breaks.forEach((b, i) => {
      if (
        b.start >= b.end ||
        b.start < r.start ||
        b.end > r.end ||
        (i > 0 && breaks[i - 1]!.end > b.start)
      )
        ctx.addIssue({
          code: "custom",
          message: "Перерывы внутри рабочего дня, без пересечений",
        });
    });
  });
export type ScheduleRules = z.infer<typeof scheduleRulesSchema>;
export interface ScheduleService {
  id: string;
  title: string;
  durationMinutes: number;
}
export interface ScheduleInterval {
  serviceId: string;
  title: string;
  durationMinutes: number;
  bufferMinutes: number;
  timezone: string;
  localStart: string;
  localEnd: string;
  startsAt: string;
  endsAt: string;
  occupiedUntil: string;
}
export interface SchedulePreview {
  slots: ScheduleInterval[];
  errors: { row: number; message: string }[];
  omissions: string[];
  committable: boolean;
}
/** Offset is an explicit owner resolution, never a guessed host/browser offset. */
export function resolveScheduleTime(
  local: string,
  timezone: string,
  offset?: string,
): string {
  if (!/^20\d{2}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/u.test(local))
    throw Error("Неверное местное время");
  const plain = Temporal.PlainDateTime.from(local, { overflow: "reject" });
  const zoned = offset
    ? Temporal.ZonedDateTime.from(`${local}${offset}[${timezone}]`, {
        overflow: "reject",
        offset: "reject",
        disambiguation: "reject",
      })
    : plain.toZonedDateTime(timezone, { disambiguation: "reject" });
  return new Date(zoned.epochMilliseconds).toISOString();
}
function checkedServices(services: readonly ScheduleService[]): void {
  if (
    !services.length ||
    services.length > 8 ||
    new Set(services.map((s) => s.id)).size !== services.length ||
    services.some(
      (s) =>
        !s.id ||
        s.id.length > 80 ||
        !s.title.trim() ||
        s.title.length > 160 ||
        !Number.isInteger(s.durationMinutes) ||
        s.durationMinutes < 5 ||
        s.durationMinutes > 1440,
    )
  )
    throw Error("Проверьте услуги и длительность");
}
function interval(
  r: ScheduleRules,
  service: ScheduleService,
  date: string,
  start: number,
  offset?: string,
): ScheduleInterval {
  const end = start + service.durationMinutes,
    occupied = end + r.bufferMinutes;
  if (
    date < r.from ||
    date > r.to ||
    !r.weekdays.includes(Temporal.PlainDate.from(date).dayOfWeek - 1) ||
    start < minutes(r.start) ||
    occupied > minutes(r.end) ||
    r.breaks.some((b) => start < minutes(b.end) && occupied > minutes(b.start))
  )
    throw Error(
      "Встреча с буфером должна целиком помещаться в рабочее время без перерывов",
    );
  const localStart = `${date}T${hhmm(start)}`,
    localEnd = `${date}T${hhmm(end)}`;
  const startsAt = resolveScheduleTime(localStart, r.timezone, offset);
  // Every endpoint is resolved independently; elapsed and local duration must agree.
  const endsAt = resolveScheduleTime(localEnd, r.timezone, offset);
  const occupiedUntil = resolveScheduleTime(
    `${date}T${hhmm(occupied)}`,
    r.timezone,
    offset,
  );
  if (
    +new Date(endsAt) - +new Date(startsAt) !==
      service.durationMinutes * 60000 ||
    +new Date(occupiedUntil) - +new Date(endsAt) !== r.bufferMinutes * 60000
  )
    throw Error("Переход часового пояса: выберите интервал без смены смещения");
  return {
    serviceId: service.id,
    title: service.title,
    durationMinutes: service.durationMinutes,
    bufferMinutes: r.bufferMinutes,
    timezone: r.timezone,
    localStart,
    localEnd,
    startsAt,
    endsAt,
    occupiedUntil,
  };
}
export function generateSchedule(
  input: unknown,
  services: readonly ScheduleService[],
): SchedulePreview {
  const r = scheduleRulesSchema.parse(input);
  checkedServices(services);
  const result: SchedulePreview = {
    slots: [],
    errors: [],
    omissions: [],
    committable: true,
  };
  const breaks = [...r.breaks].sort((a, b) => a.start.localeCompare(b.start));
  for (
    let d = Temporal.PlainDate.from(r.from);
    d.toString() <= r.to;
    d = d.add({ days: 1 })
  ) {
    if (!r.weekdays.includes(d.dayOfWeek - 1)) continue;
    for (const service of services) {
      let cursor = minutes(r.start);
      while (
        cursor + service.durationMinutes + r.bufferMinutes <=
        minutes(r.end)
      ) {
        const busy = breaks.find(
          (b) =>
            cursor < minutes(b.end) &&
            cursor + service.durationMinutes + r.bufferMinutes >
              minutes(b.start),
        );
        if (busy) {
          if (result.omissions.length >= 500) {
            result.errors.push({
              row: 0,
              message: "Не более 500 пропусков: сократите период",
            });
            result.committable = false;
            return result;
          }
          result.omissions.push(
            `${d} ${hhmm(cursor)} ${service.title}: перерыв`,
          );
          cursor = minutes(busy.end);
          continue;
        }
        if (result.slots.length >= 500) {
          result.errors.push({
            row: 0,
            message: "Не более 500 слотов: сократите период",
          });
          result.committable = false;
          return result;
        }
        try {
          result.slots.push(interval(r, service, d.toString(), cursor));
        } catch {
          result.errors.push({
            row: 0,
            message: `${d} ${hhmm(cursor)}: отсутствующее/неоднозначное время или переход смещения; выберите другое время либо явное смещение при импорте`,
          });
        }
        cursor += service.durationMinutes + r.bufferMinutes;
      }
    }
  }
  result.committable = result.errors.length === 0;
  return result;
}
function csv(line: string): string[] {
  const fields: string[] = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      fields.push(value.trim());
      value = "";
    } else value += c;
  }
  if (quoted) throw Error("Незакрытая кавычка CSV");
  fields.push(value.trim());
  return fields;
}
export function importSchedule(
  raw: string,
  input: unknown,
  services: readonly ScheduleService[],
): SchedulePreview {
  const r = scheduleRulesSchema.parse(input);
  checkedServices(services);
  if (new TextEncoder().encode(raw).length > 64000)
    throw Error("Импорт не более 64 КБ");
  const lines = raw.split(/\r?\n/u);
  if (lines.length > 500) throw Error("Импорт не более 500 строк");
  const result: SchedulePreview = {
    slots: [],
    errors: [],
    omissions: [],
    committable: true,
  };
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const text =
        /^(\d{4}-\d{2}-\d{2}) ([0-2]\d:[0-5]\d)-([0-2]\d:[0-5]\d) (.+)$/u.exec(
          line,
        );
      const fields = text ? text.slice(1) : csv(line);
      if (fields.length !== 4 && fields.length !== 5)
        throw Error(
          "Формат: YYYY-MM-DD HH:MM-HH:MM Название либо CSV дата,начало,конец,услуга[,смещение]",
        );
      const [date, start, end, name, offset] = fields as [
        string,
        string,
        string,
        string,
        string?,
      ];
      day.parse(date);
      clock.parse(start);
      clock.parse(end);
      const matches = services.filter((s) =>
        name.startsWith("id:") ? s.id === name.slice(3) : s.title === name,
      );
      if (matches.length !== 1)
        throw Error(
          matches.length
            ? "Неоднозначное название: выберите id:номер услуги из своего списка"
            : "Услуга не найдена в вашем списке",
        );
      if (minutes(end) - minutes(start) !== matches[0]!.durationMinutes)
        throw Error("Интервал не соответствует длительности услуги");
      const slot = interval(r, matches[0]!, date, minutes(start), offset);
      if (
        result.slots.some(
          (s) =>
            s.serviceId === slot.serviceId &&
            s.startsAt < slot.occupiedUntil &&
            s.occupiedUntil > slot.startsAt,
        )
      )
        throw Error("Дубликат или пересечение времени этой услуги");
      result.slots.push(slot);
    } catch (error) {
      result.errors.push({
        row: i + 1,
        message:
          error instanceof z.ZodError
            ? "Проверьте дату и время"
            : error instanceof Error
              ? error.message
              : "Проверьте строку",
      });
    }
  });
  result.committable = result.errors.length === 0;
  return result;
}
