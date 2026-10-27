/** Private card rendering: lossless Russian labels, never HTML. */
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
