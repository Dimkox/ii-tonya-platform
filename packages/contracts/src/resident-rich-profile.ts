import { z } from "zod";
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(v),
      "Уберите управляющие символы",
    );
/** References only. This validator never authorizes a network request. IP literals are deliberately excluded. */
export function richPublicHttps(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      value.length <= 2048 &&
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/[\s\\\u0000-\u001f]/u.test(value) &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/iu.test(
        u.hostname,
      ) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(u.hostname)
    );
  } catch {
    return false;
  }
}
const url = z.string().refine(richPublicHttps, "Нужна публичная HTTPS ссылка");
const money = z.string().regex(/^(?:0|[1-9]\d{0,6})\.\d{2}$/u);
const minor = (s: string) => BigInt(s.replace(".", ""));
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/u)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
  }, "Дата YYYY-MM-DD");
export const richServiceSchema = z.strictObject({
  id: z.uuid().transform((v) => v.toLowerCase()),
  title: text(160),
  format: z.enum(["ONLINE", "OFFLINE", "HYBRID", "EVENT"]),
  eventDelivery: z.enum(["ONLINE", "OFFLINE", "HYBRID"]).nullable(),
  durationMinutes: z.number().int().min(5).max(1440),
  price: z
    .strictObject({
      kind: z.enum(["exact", "range"]),
      minRub: money,
      maxRub: money.nullable(),
    })
    .refine(
      (p) =>
        p.kind === "exact"
          ? p.maxRub === null
          : p.maxRub !== null && minor(p.maxRub) >= minor(p.minRub),
      "Укажите точную цену или корректный диапазон",
    ),
  description: text(2000),
  audience: text(1000),
  result: text(1000),
  expiryDate: date.nullable(),
  detailsUrl: url.nullable(),
  tags: z
    .array(text(80))
    .max(20)
    .refine((a) => new Set(a).size === a.length, "Теги не должны повторяться"),
});
export const richProfileSchema = z
  .strictObject({
    fullName: text(160),
    specialization: text(240),
    bio: text(2000),
    photos: z
      .array(z.uuid().transform((v) => v.toLowerCase()))
      .max(10)
      .refine(
        (a) => new Set(a).size === a.length,
        "Фото не должны повторяться",
      ),
    socialLinks: z.array(url).max(8),
    onlineRoomType: z.enum(["STATIC_LINK", "UNDECIDED"]),
    staticRoomLink: url.nullable(),
    address: text(1000),
    arrival: text(2000),
    yandexMapsUrl: url
      .refine(
        (v) =>
          new URL(v).hostname === "yandex.ru" &&
          new URL(v).pathname.startsWith("/maps"),
        "Ссылка Яндекс.Карт",
      )
      .nullable(),
    services: z.array(richServiceSchema).max(8),
  })
  .refine(
    (p) => new Set(p.services.map((s) => s.id)).size === p.services.length,
    "У услуг разные стабильные ID",
  )
  .refine(
    (p) => new TextEncoder().encode(JSON.stringify(p)).length <= 95000,
    "Сократите общий объём карточки до 95 КБ",
  );
export type RichProfile = z.infer<typeof richProfileSchema>;
export type RichService = z.infer<typeof richServiceSchema>;
export function emptyRichProfile(): RichProfile {
  return {
    fullName: "",
    specialization: "",
    bio: "",
    photos: [],
    socialLinks: [],
    onlineRoomType: "UNDECIDED",
    staticRoomLink: null,
    address: "",
    arrival: "",
    yandexMapsUrl: null,
    services: [],
  };
}
/** Completeness is separate from shape validation so valid partial answers survive. */
export function richProfileGaps(p: RichProfile): string[] {
  const gaps: string[] = [];
  for (const key of ["fullName", "specialization"] as const)
    if (!p[key].trim()) gaps.push(key);
  if (p.bio.trim().length < 50) gaps.push("bio");
  if (
    new Set(p.photos.map((v) => v.toLowerCase())).size < 3 ||
    new Set(p.photos.map((v) => v.toLowerCase())).size !== p.photos.length
  )
    gaps.push("photos");
  if (!p.socialLinks.length) gaps.push("socialLinks");
  if (!p.services.length) gaps.push("services");
  const formats = p.services.map((s) =>
    s.format === "EVENT" ? s.eventDelivery : s.format,
  );
  if (formats.some((f) => f === "ONLINE" || f === "HYBRID")) {
    if (p.onlineRoomType !== "STATIC_LINK") gaps.push("onlineRoomType");
    if (!p.staticRoomLink) gaps.push("staticRoomLink");
  }
  if (formats.some((f) => f === "OFFLINE" || f === "HYBRID")) {
    if (!p.address.trim()) gaps.push("address");
    if (!p.arrival.trim()) gaps.push("arrival");
  }
  p.services.forEach((s, i) => {
    for (const key of ["title", "audience", "result"] as const)
      if (!s[key].trim()) gaps.push(`services.${i}.${key}`);
    if (s.description.trim().length < 50)
      gaps.push(`services.${i}.description`);
    if (!s.tags.length || s.tags.some((t) => !t.trim()))
      gaps.push(`services.${i}.tags`);
    if (s.format === "EVENT" && !s.eventDelivery)
      gaps.push(`services.${i}.eventDelivery`);
  });
  return gaps;
}
/** Lossless Russian labels; values are never shortened or interpreted as markup. */
const labels: Record<string, string> = {
  fullName: "Имя / бренд",
  specialization: "Специализация",
  bio: "О себе",
  photos: "Фото карточки",
  socialLinks: "Контакты и социальные сети",
  onlineRoomType: "Онлайн-комната",
  staticRoomLink: "Ссылка на постоянную комнату",
  address: "Полный адрес",
  arrival: "Как добраться",
  yandexMapsUrl: "Ссылка Яндекс.Карт",
  services: "Услуги",
  partialServices: "Услуги, требующие дополнения",
  id: "Номер услуги",
  title: "Название услуги",
  format: "Формат",
  eventDelivery: "Формат мероприятия",
  durationMinutes: "Длительность, минут",
  price: "Стоимость, рублей",
  kind: "Вид цены",
  minRub: "Цена / от",
  maxRub: "До",
  description: "Описание услуги",
  audience: "Для кого",
  result: "Ожидаемый результат",
  expiryDate: "Действует до",
  detailsUrl: "Подробнее об услуге",
  tags: "Темы и теги",
  displayName: "Публичное имя",
  profession: "Публичная специализация",
  city: "Город",
  summary: "Публичное описание",
};
const choices: Record<string, string> = {
  ONLINE: "Онлайн",
  OFFLINE: "Очно",
  HYBRID: "Онлайн и очно",
  EVENT: "Мероприятие",
  STATIC_LINK: "Постоянная ссылка",
  UNDECIDED: "Пока не выбрана",
  exact: "Точная цена",
  range: "Диапазон",
};
function readable(value: unknown, key = ""): string {
  if (value === null || value === undefined) return "Не указано";
  if (Array.isArray(value))
    return value.length
      ? value.map((v, i) => `${i + 1}. ${readable(v)}`).join("\n")
      : "Не указано";
  if (typeof value === "object")
    return Object.entries(value)
      .map(([k, v]) => `${labels[k] ?? k}: ${readable(v, k)}`)
      .join("\n");
  return ["format", "eventDelivery", "onlineRoomType", "kind"].includes(key)
    ? (choices[String(value)] ?? String(value))
    : String(value);
}
export function richReadablePages(value: unknown): string[] {
  const pages: string[] = [];
  let page = "";
  for (const char of readable(value)) {
    if (page.length + char.length > 3000) {
      pages.push(page);
      page = "";
    }
    page += char;
  }
  if (page) pages.push(page);
  return pages.length ? pages : ["Не указано"];
}
export function richPreviewPages(
  p: RichProfile,
  publicCard: unknown = null,
): string[] {
  return richReadablePages({
    "Профиль и услуги": p,
    "Публичная карточка": publicCard,
  });
}
export const richProfilePatchSchema = z
  .strictObject(richProfileSchema.shape)
  .partial();
export const partialRichServiceSchema = richServiceSchema.partial();
export const richProposalSchema = richProfilePatchSchema.extend({
  partialServices: z.array(partialRichServiceSchema).max(8).optional(),
});
export type RichProposal = z.infer<typeof richProposalSchema>;
export type GuidedService = z.infer<typeof partialRichServiceSchema>;
const modes: Record<string, RichService["format"]> = {
  онлайн: "ONLINE",
  очно: "OFFLINE",
  офлайн: "OFFLINE",
  "онлайн и очно": "HYBRID",
  гибрид: "HYBRID",
  мероприятие: "EVENT",
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  HYBRID: "HYBRID",
  EVENT: "EVENT",
};
function amount(input: string): string {
  const v = input.trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/u.test(v))
    throw Error("Укажите рубли числом, например 2500,50");
  const [r, c = ""] = v.split(".");
  return r + "." + c.padEnd(2, "0");
}
function parsePrice(input: string): RichService["price"] {
  const parts = input.split(/\s*[-–]\s*/u);
  if (parts.length === 1)
    return { kind: "exact", minRub: amount(parts[0]!), maxRub: null };
  if (parts.length === 2)
    return richServiceSchema.shape.price.parse({
      kind: "range",
      minRub: amount(parts[0]!),
      maxRub: amount(parts[1]!),
    });
  throw Error("Укажите цену или диапазон: 2500 либо 2000–3000");
}
const serviceFields = [
  "title",
  "format",
  "eventDelivery",
  "durationMinutes",
  "price",
  "description",
  "audience",
  "result",
  "tags",
  "expiryDate",
  "detailsUrl",
] as const;
function nextService(s: GuidedService) {
  return serviceFields.find(
    (k) =>
      (k !== "eventDelivery" || s.format === "EVENT") &&
      (s[k] === undefined ||
        (["title", "audience", "result"].includes(k) &&
          !String(s[k] ?? "").trim()) ||
        (k === "description" && String(s[k] ?? "").trim().length < 50) ||
        (k === "tags" && (!s.tags?.length || s.tags.some((t) => !t.trim()))) ||
        (k === "eventDelivery" && s.eventDelivery === null)),
  );
}
function nextField(p: RichProfile, s: GuidedService): string {
  for (const k of ["fullName", "specialization"] as const)
    if (!p[k].trim()) return k;
  if (p.bio.trim().length < 50) return "bio";
  if (!p.socialLinks.length) return "socialLinks";
  if (!p.services.length || Object.keys(s).length)
    return "service." + (nextService(s) ?? "title");
  const modes = p.services.map((x) =>
    x.format === "EVENT" ? x.eventDelivery : x.format,
  );
  if (
    modes.some((x) => x === "ONLINE" || x === "HYBRID") &&
    (p.onlineRoomType !== "STATIC_LINK" || !p.staticRoomLink)
  )
    return "staticRoomLink";
  if (modes.some((x) => x === "OFFLINE" || x === "HYBRID")) {
    if (!p.address.trim()) return "address";
    if (!p.arrival.trim()) return "arrival";
  }
  if (new Set(p.photos.map((v) => v.toLowerCase())).size < 3) return "photos";
  return "complete";
}
const questions: Record<string, string> = {
  fullName: "Как вас представить: имя и фамилия или название бренда?",
  specialization: "Какая у вас специализация?",
  bio: "Расскажите о вашем опыте и подходе, не менее 50 символов.",
  socialLinks:
    "Пришлите публичные HTTPS ссылки на ваши контакты или социальные сети, по одной в строке.",
  staticRoomLink:
    "Пришлите публичную HTTPS ссылку постоянной онлайн-комнаты. Если её пока нет, можно вернуться позднее; отправить карточку на проверку пока нельзя.",
  address: "Укажите полный адрес очной встречи.",
  arrival: "Как добраться: вход, этаж и другие инструкции для гостя.",
  photos:
    "Пришлите как минимум три разных фото отдельными загрузками в этот бот. Фото останутся закрытыми до отдельного решения о публикации.",
  complete:
    "Все обязательные ответы сохранены. Откройте /card_preview для полного просмотра. Добавить ещё услугу: /card_service_add.",
  "service.title": "Какое название услуги?",
  "service.format":
    "Формат услуги: онлайн, очно, онлайн и очно или мероприятие?",
  "service.eventDelivery":
    "Как проходит мероприятие: онлайн, очно или онлайн и очно?",
  "service.durationMinutes":
    "Сколько минут длится услуга? Введите целое число от 5 до 1440.",
  "service.price":
    "Стоимость в рублях: например 2500,50 или диапазон 2000–3000. Это информация для клиента, не счёт платформы.",
  "service.description": "Подробно опишите услугу, не менее 50 символов.",
  "service.audience": "Для кого эта услуга?",
  "service.result": "Какой результат предполагается после услуги?",
  "service.tags":
    "Какие темы и теги описывают услугу? Перечислите через запятую.",
  "service.expiryDate":
    "До какой даты действует предложение? Год-месяц-день, например 2027-12-31, либо «нет».",
  "service.detailsUrl":
    "Есть публичная HTTPS ссылка с подробностями услуги? Пришлите её либо ответьте «нет».",
};
export function guidedRichQuestion(
  p: RichProfile,
  s: GuidedService = {},
): string {
  const key = nextField(p, s);
  return (
    questions[key]! +
    (key === "photos" || key === "complete"
      ? ""
      : "\nОтветьте: /card_answer ваш ответ")
  );
}
export function guidedRichAnswer(
  p: RichProfile,
  staged: GuidedService,
  input: string,
  id: () => string,
): { profile: RichProfile; staged: GuidedService } {
  const key = nextField(p, staged),
    v = input.trim();
  if (!v) throw Error("Введите ответ");
  let profile = { ...p };
  let s = { ...staged };
  if (key.startsWith("service.")) {
    const field = key.slice(8) as (typeof serviceFields)[number];
    let value: unknown = v;
    if (field === "format" || field === "eventDelivery") {
      value = modes[v.toLowerCase()] ?? modes[v];
      if (!value || (field === "eventDelivery" && value === "EVENT"))
        throw Error(
          "Выберите онлайн, очно, онлайн и очно" +
            (field === "format" ? " или мероприятие" : ""),
        );
    }
    if (field === "durationMinutes") {
      if (!/^\d{1,4}$/u.test(v)) throw Error("Введите целое число минут");
      value = Number(v);
    }
    if (field === "price") value = parsePrice(v);
    if (field === "tags") value = v.split(",").map((x) => x.trim());
    if (field === "expiryDate" || field === "detailsUrl")
      value = v.toLowerCase() === "нет" ? null : v;
    const checked = richServiceSchema.shape[field].safeParse(value);
    if (!checked.success) throw Error("Проверьте ответ: " + questions[key]);
    if (field === "description" && v.length < 50)
      throw Error("Описание должно содержать не менее 50 символов");
    s = { ...s, id: s.id ?? id(), [field]: checked.data };
    if (!nextService(s)) {
      const service = richServiceSchema.parse({
        ...s,
        eventDelivery: s.eventDelivery ?? null,
      });
      profile = richProfileSchema.parse({
        ...profile,
        services: [...profile.services, service],
      });
      s = {};
    }
  } else if (key === "photos" || key === "complete")
    throw Error(questions[key]);
  else {
    const value = key === "socialLinks" ? v.split(/\s+/u) : v;
    const patch = richProfilePatchSchema.safeParse({
      [key]: value,
      ...(key === "staticRoomLink" ? { onlineRoomType: "STATIC_LINK" } : {}),
    });
    if (!patch.success) throw Error("Проверьте ответ: " + questions[key]);
    if (key === "bio" && v.length < 50)
      throw Error("Рассказ должен содержать не менее 50 символов");
    profile = richProfileSchema.parse({ ...profile, ...patch.data });
  }
  return { profile, staged: s };
}
/** Explicit labels only; no guesses, URL fetching or runtime LLM. */
export function proposeRichFields(
  input: string,
  idForService: (index: number) => string = () => crypto.randomUUID(),
): RichProposal {
  if (input.length > 64000) return {};
  const result: Record<string, unknown> = {};
  let service: Record<string, unknown> = {};
  const services: RichService[] = [];
  const partialServices: GuidedService[] = [];
  let serviceIndex = 0;
  const russian = Object.fromEntries(
    Object.entries(labels).map(([k, v]) => [v.toLowerCase(), k]),
  );
  const flush = () => {
    if (!Object.keys(service).length) return;
    const parsed = richServiceSchema.safeParse({
      id: idForService(serviceIndex++),
      eventDelivery: null,
      expiryDate: null,
      detailsUrl: null,
      ...service,
    });
    if (parsed.success && !nextService(parsed.data)) services.push(parsed.data);
    else
      partialServices.push(
        partialRichServiceSchema.parse({
          id: idForService(serviceIndex - 1),
          ...service,
        }),
      );
    service = {};
  };
  for (const line of input.split("\n")) {
    const m = /^([^:]+):\s*(.+)$/u.exec(line);
    if (!m) continue;
    const key = russian[m[1]!.trim().toLowerCase()] ?? m[1]!.trim();
    let value: unknown = m[2]!.trim();
    if (serviceFields.includes(key as (typeof serviceFields)[number])) {
      if (key === "title") flush();
      try {
        if (key === "format" || key === "eventDelivery")
          value = modes[String(value).toLowerCase()] ?? value;
        if (key === "durationMinutes")
          value = /^\d{1,4}$/u.test(String(value)) ? Number(value) : value;
        if (key === "price") value = parsePrice(String(value));
        if (key === "tags")
          value = String(value)
            .split(",")
            .map((x) => x.trim());
        if (
          (key === "expiryDate" || key === "detailsUrl") &&
          String(value).toLowerCase() === "нет"
        )
          value = null;
        const parsed =
          richServiceSchema.shape[
            key as (typeof serviceFields)[number]
          ].safeParse(value);
        if (parsed.success) service[key] = parsed.data;
      } catch {
        /* Raw file remains available; invalid field is not proposed. */
      }
      continue;
    }
    if (key === "socialLinks" && !String(value).startsWith("["))
      value = String(value).split(/\s+/u);
    else if (["socialLinks", "services"].includes(key)) {
      try {
        value = JSON.parse(String(value));
      } catch {
        continue;
      }
    }
    if (key === "onlineRoomType")
      value =
        String(value).toLowerCase() === "постоянная ссылка"
          ? "STATIC_LINK"
          : String(value).toLowerCase() === "пока не выбрана"
            ? "UNDECIDED"
            : value;
    if (value === "нет") value = null;
    const parsed = richProfilePatchSchema.safeParse({ [key]: value });
    if (parsed.success) Object.assign(result, parsed.data);
  }
  flush();
  if (services.length) result.services = services;
  if (partialServices.length) result.partialServices = partialServices;
  return richProposalSchema.parse(result);
}
export function richChecklist(): string {
  return `# Карточка резидента — мастер-чек-лист
Скопируйте и заполните строки. Отправьте текстом или PDF/DOCX; затем проверьте предложенные поля. Фото отправьте отдельно в этот бот. Ссылки сохраняются без загрузки.
Имя / бренд:
Специализация:
О себе: опыт и подход, не менее 50 символов
Контакты и социальные сети: публичные HTTPS ссылки через пробел
Онлайн-комната: постоянная ссылка или пока не выбрана
Ссылка на постоянную комнату:
Полный адрес: для очных встреч
Как добраться: вход, этаж, инструкции
Ссылка Яндекс.Карт: необязательно, можно исправить вручную

Для каждой услуги повторите этот блок (не более восьми):
Название услуги:
Формат: онлайн / очно / онлайн и очно / мероприятие
Формат мероприятия: онлайн / очно / онлайн и очно (только для мероприятия)
Длительность, минут:
Стоимость, рублей: 2500,50 или 2000–3000
Описание услуги: не менее 50 символов
Для кого:
Ожидаемый результат:
Темы и теги: через запятую
Действует до: год-месяц-день или нет
Подробнее об услуге: HTTPS ссылка или нет

Цены информационные. Нужна помощь с заполнением? /card_mode — вопросы по одному, /card_manager — запрос менеджеру.`;
}
