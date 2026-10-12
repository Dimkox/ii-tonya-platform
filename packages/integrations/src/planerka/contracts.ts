import { z } from "zod";

// Provider contract: https://planerka.app/rest/v2/doc.json (2026-10-12).
const integer = z.number().int().safe();
const id = integer.positive();
const nonnegative = integer.nonnegative();
const text = z.string().max(16_384);
const inputText = z
  .string()
  .min(1)
  .max(1_024)
  .regex(/^[^\u0000-\u001f\u007f]*$/u);
export const planerkaUidSchema = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/u);
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const timeZone = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const nullableText = text.nullable().optional();
const object = z.record(z.string(), z.json());
const collection = <T extends z.ZodType>(schema: T) =>
  z.union([
    z.array(schema),
    z.record(z.string(), schema).transform((value) => Object.values(value)),
  ]);
export const planerkaEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({ status: z.literal("success"), data });

export const planerkaProfileSchema = z.object({
  id,
  username: nullableText,
  name: nullableText,
  avatarUrl: nullableText,
  bio: nullableText,
  timeZone,
  weekStart: text,
});
export const planerkaEventTypeSchema = z.object({
  id,
  ownerId: id,
  title: text,
  slug: text,
  description: nullableText,
  lengthInMinutes: id,
  length: id,
  hidden: z.boolean(),
  position: integer,
  locations: z.array(object),
  schedulingType: z.enum(["ROUND_ROBIN", "COLLECTIVE"]).nullable().optional(),
  seatsPerTimeSlot: id.nullable().optional(),
  price: nonnegative,
  currency: text,
  requiresConfirmation: z.boolean(),
  disableGuests: z.boolean(),
  minimumBookingNotice: nonnegative,
  beforeEventBuffer: nonnegative,
  afterEventBuffer: nonnegative,
  slotInterval: id.nullable().optional(),
});
export const planerkaEventTypesSchema = collection(planerkaEventTypeSchema);
const host = z.object({
  id,
  name: text,
  email: text,
  displayEmail: text,
  username: text,
  timeZone,
});
const attendee = z.object({
  name: text,
  email: text,
  displayEmail: text,
  phone: nullableText,
  telegram: nullableText,
  company: nullableText,
  timeZone,
  absent: z.boolean(),
});
export const planerkaBookingSchema = z
  .object({
    id,
    uid: planerkaUidSchema,
    title: text,
    description: text,
    hosts: collection(host),
    status: z.enum(["accepted", "pending", "cancelled", "rejected"]),
    start: timestamp,
    end: timestamp,
    duration: id,
    eventTypeId: id,
    eventType: z.object({ id, slug: text }),
    location: text,
    meetingUrl: text,
    absentHost: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    attendees: collection(attendee),
    bookingFieldsResponses: object,
  })
  .refine(
    (value) =>
      Date.parse(value.end) > Date.parse(value.start) &&
      Date.parse(value.end) - Date.parse(value.start) ===
        value.duration * 60_000 &&
      value.eventTypeId === value.eventType.id,
  );
export const planerkaBookingPageSchema = z
  .object({
    status: z.literal("success"),
    data: collection(planerkaBookingSchema),
    pagination: z.object({
      totalItems: nonnegative,
      remainingItems: nonnegative,
      returnedItems: nonnegative,
      itemsPerPage: id,
      currentPage: nonnegative,
      totalPages: nonnegative,
      hasNextPage: z.boolean(),
      hasPreviousPage: z.boolean(),
    }),
  })
  .refine(
    (value) =>
      value.pagination.returnedItems === value.data.length &&
      value.data.length <= value.pagination.itemsPerPage &&
      value.pagination.totalItems >=
        value.data.length + value.pagination.remainingItems &&
      value.pagination.totalPages ===
        Math.ceil(
          value.pagination.totalItems / value.pagination.itemsPerPage,
        ) &&
      value.pagination.hasNextPage === value.pagination.remainingItems > 0 &&
      value.pagination.hasPreviousPage === value.pagination.currentPage > 1,
  );
export const planerkaSlotsSchema = z.record(
  date,
  z.array(
    z
      .object({ start: timestamp, end: timestamp.nullable().optional() })
      .refine(
        (slot) => !slot.end || Date.parse(slot.end) > Date.parse(slot.start),
      ),
  ),
);

const selector = {
  eventTypeId: id.optional(),
  eventTypeSlug: inputText.optional(),
  username: inputText.optional(),
};
const hasSelector = (value: {
  eventTypeId?: number | undefined;
  eventTypeSlug?: string | undefined;
  username?: string | undefined;
}) =>
  value.eventTypeId !== undefined
    ? value.eventTypeSlug === undefined && value.username === undefined
    : value.eventTypeSlug !== undefined && value.username !== undefined;
// Local resource bound, not a claimed provider limit: at most 31 inclusive dates.
export const planerkaSlotsQuerySchema = z
  .object({
    ...selector,
    start: date,
    end: date,
    timeZone: timeZone.default("UTC"),
    duration: id.max(1_440).optional(),
    format: z.enum(["time", "range"]).optional(),
  })
  .strict()
  .refine(hasSelector)
  .refine((value) => {
    const span = Date.parse(value.end) - Date.parse(value.start);
    return span >= 0 && span <= 30 * 86_400_000;
  });
export const planerkaCreateBookingSchema = z
  .object({
    ...selector,
    start: timestamp,
    attendee: z
      .object({
        name: inputText,
        timeZone,
        email: z.email().max(320).nullable().optional(),
        phoneNumber: inputText.nullable().optional(),
        telegram: inputText.nullable().optional(),
        company: inputText.nullable().optional(),
        language: inputText.nullable().optional(),
      })
      .strict(),
    lengthInMinutes: id.max(1_440).nullable().optional(),
    guests: z
      .union([
        z.array(z.email()).max(100),
        z
          .record(z.string(), z.email())
          .refine((guests) => Object.keys(guests).length <= 100),
      ])
      .nullable()
      .optional(),
    location: inputText.nullable().optional(),
    metadata: object.nullable().optional(),
    bookingFieldsResponses: object.nullable().optional(),
  })
  .strict()
  .refine(hasSelector);
export const planerkaCancelBookingSchema = z
  .object({ cancellationReason: inputText.nullable().optional() })
  .strict();
export const planerkaBookingsQuerySchema = z
  .object({
    status: z
      .string()
      .regex(
        /^(upcoming|past|cancelled|unconfirmed)(,(upcoming|past|cancelled|unconfirmed))*$/u,
      )
      .max(128)
      .optional(),
    attendeeEmail: z.email().max(320).optional(),
    eventTypeId: id.optional(),
    afterStart: timestamp.optional(),
    beforeEnd: timestamp.optional(),
    take: id.max(100).optional(),
    skip: nonnegative.optional(),
    sortStart: z.enum(["asc", "desc"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.afterStart ||
      !value.beforeEnd ||
      Date.parse(value.afterStart) < Date.parse(value.beforeEnd),
  );

export type PlanerkaProfile = z.output<typeof planerkaProfileSchema>;
export type PlanerkaEventType = z.output<typeof planerkaEventTypeSchema>;
export type PlanerkaBooking = z.output<typeof planerkaBookingSchema>;
export type PlanerkaBookingPage = Omit<
  z.output<typeof planerkaBookingPageSchema>,
  "status"
>;
export type PlanerkaSlots = z.output<typeof planerkaSlotsSchema>;
export type PlanerkaSlotsQuery = z.input<typeof planerkaSlotsQuerySchema>;
export type PlanerkaBookingsQuery = z.input<typeof planerkaBookingsQuerySchema>;
export type CreatePlanerkaBooking = z.input<typeof planerkaCreateBookingSchema>;
export type CancelPlanerkaBooking = z.input<typeof planerkaCancelBookingSchema>;
