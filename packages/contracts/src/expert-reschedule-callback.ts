/**
 * SCRUM-64: callback_data кнопки 🔄 «Перенести» и выбора нового слота.
 * Данные несут только UUID брони/слота; полномочия всегда проверяет сервер:
 * Telegram id → активный резидент → бронь этого эксперта, до чтения и изменения.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const B64_UUID = "[A-Za-z0-9_-]{22}";
export const EXPERT_RESCHEDULE_START_PATTERN = new RegExp(
  `^rs1\\.(${B64_UUID})$`,
  "u",
);
export const EXPERT_RESCHEDULE_PICK_PATTERN = new RegExp(
  `^rs2\\.(${B64_UUID})(${B64_UUID})$`,
  "u",
);

const encodeUuid = (id: string): string => {
  const lower = id.toLowerCase();
  if (!UUID.test(lower)) throw new Error("expert_reschedule_callback_invalid");
  return Buffer.from(lower.replaceAll("-", ""), "hex").toString("base64url");
};
const decodeUuid = (value: string): string | null => {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 16 || bytes.toString("base64url") !== value)
    return null;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const encodeExpertRescheduleStart = (reservationId: string): string =>
  `rs1.${encodeUuid(reservationId)}`;
export const encodeExpertReschedulePick = (
  reservationId: string,
  slotId: string,
): string => `rs2.${encodeUuid(reservationId)}${encodeUuid(slotId)}`;

export type ExpertRescheduleCallback =
  | { readonly kind: "start"; readonly reservationId: string }
  | {
      readonly kind: "pick";
      readonly reservationId: string;
      readonly slotId: string;
    };

export const parseExpertRescheduleCallback = (
  data: string,
): ExpertRescheduleCallback | null => {
  const start = EXPERT_RESCHEDULE_START_PATTERN.exec(data);
  if (start !== null) {
    const reservationId = decodeUuid(start[1]!);
    return reservationId === null ? null : { kind: "start", reservationId };
  }
  const pick = EXPERT_RESCHEDULE_PICK_PATTERN.exec(data);
  if (pick !== null) {
    const reservationId = decodeUuid(pick[1]!);
    const slotId = decodeUuid(pick[2]!);
    return reservationId === null || slotId === null
      ? null
      : { kind: "pick", reservationId, slotId };
  }
  return null;
};
