import { z } from "zod";
import {
  planerkaBookingPageSchema,
  planerkaBookingSchema,
  planerkaBookingsQuerySchema,
  planerkaCancelBookingSchema,
  planerkaCreateBookingSchema,
  planerkaEnvelope,
  planerkaEventTypesSchema,
  planerkaProfileSchema,
  planerkaSlotsQuerySchema,
  planerkaSlotsSchema,
  planerkaUidSchema,
  type CancelPlanerkaBooking,
  type CreatePlanerkaBooking,
  type PlanerkaBooking,
  type PlanerkaBookingPage,
  type PlanerkaBookingsQuery,
  type PlanerkaEventType,
  type PlanerkaProfile,
  type PlanerkaSlots,
  type PlanerkaSlotsQuery,
} from "./contracts.js";

const BASE_URL = "https://planerka.app/rest/v2";
const MAX_BYTES = 256 * 1024;
export type PlanerkaErrorCode =
  | "invalid_input"
  | "access_denied"
  | "conflict"
  | "rate_limited"
  | "not_found"
  | "rejected"
  | "invalid_response"
  | "transport_failure"
  | "unknown_outcome";
/** Contains only fixed diagnostics. Never retains request, response, key or cause. */
export class PlanerkaClientError extends Error {
  constructor(readonly code: PlanerkaErrorCode) {
    super(`planerka_${code}`);
    this.name = "PlanerkaClientError";
  }
}
export class PlanerkaUnknownOutcomeError extends PlanerkaClientError {
  constructor() {
    super("unknown_outcome");
    this.name = "PlanerkaUnknownOutcomeError";
  }
}
export interface PlanerkaTransport {
  (url: string, init: RequestInit): Promise<Response>;
}
export interface PlanerkaClientConfig {
  apiKey: string;
  timeoutMs?: number;
}
export type PlanerkaBookingLookup =
  { kind: "found"; booking: PlanerkaBooking } | { kind: "missing" };
export interface PlanerkaClient {
  getProfile(): Promise<PlanerkaProfile>;
  listEventTypes(): Promise<PlanerkaEventType[]>;
  listSlots(query: PlanerkaSlotsQuery): Promise<PlanerkaSlots>;
  listBookings(query?: PlanerkaBookingsQuery): Promise<PlanerkaBookingPage>;
  getBooking(uid: string): Promise<PlanerkaBookingLookup>;
  createBooking(command: CreatePlanerkaBooking): Promise<PlanerkaBooking>;
  cancelBooking(
    uid: string,
    command?: CancelPlanerkaBooking,
  ): Promise<PlanerkaBooking>;
}

function validate<T extends z.ZodType>(
  schema: T,
  value: unknown,
  code: PlanerkaErrorCode,
): z.output<T> {
  try {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    /* Do not expose validator exceptions or input values. */
  }
  throw new PlanerkaClientError(code);
}
const queryString = (value: object) => {
  const query = new URLSearchParams();
  for (const [key, item] of Object.entries(value))
    if (item !== undefined) query.set(key, String(item));
  return query.size ? `?${query}` : "";
};
const serialize = (value: unknown) => {
  try {
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) <= MAX_BYTES) return body;
  } catch {
    /* No raw serialization diagnostics. */
  }
  throw new PlanerkaClientError("invalid_input");
};

export function createPlanerkaClient(
  config: PlanerkaClientConfig,
  transport: PlanerkaTransport = (url, init) => fetch(url, init),
): PlanerkaClient {
  const settings = validate(
    z
      .object({
        apiKey: z.string().regex(/^cal_[A-Za-z0-9_-]{1,252}$/u),
        timeoutMs: z.number().int().min(1).max(60_000).default(15_000),
      })
      .strict(),
    config,
    "invalid_input",
  );

  async function request<T extends z.ZodType>(
    path: string,
    schema: T,
    options: {
      body?: string;
      slots?: boolean;
      created?: boolean;
      check?: (value: z.output<T>) => boolean;
    } = {},
  ): Promise<z.output<T>> {
    const mutation = options.body !== undefined;
    const controller = new AbortController();
    const expiresAt = performance.now() + settings.timeoutMs;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelBody = () => {
      if (reader) void reader.cancel().catch(() => {});
    };
    const checkDeadline = () => {
      if (controller.signal.aborted || performance.now() >= expiresAt) {
        cancelBody();
        throw new PlanerkaClientError("transport_failure");
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        cancelBody();
        reject(new PlanerkaClientError("transport_failure"));
      }, settings.timeoutMs);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await transport(`${BASE_URL}${path}`, {
            method: mutation ? "POST" : "GET",
            redirect: "error",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${settings.apiKey}`,
              "cal-api-version": options.slots ? "2024-09-04" : "2024-08-13",
              ...(mutation ? { "Content-Type": "application/json" } : {}),
            },
            ...(mutation ? { body: options.body } : {}),
          });
          if (response.body) reader = response.body.getReader();
          checkDeadline();
          if (
            response.redirected ||
            (response.status >= 300 && response.status < 400)
          )
            throw new PlanerkaClientError("invalid_response");
          if (response.status === 401 || response.status === 403)
            throw new PlanerkaClientError("access_denied");
          if (response.status === 409)
            throw new PlanerkaClientError("conflict");
          if (response.status === 429)
            throw new PlanerkaClientError("rate_limited");
          if (response.status === 404)
            throw new PlanerkaClientError("not_found");
          if (response.status >= 500 || response.status === 408)
            throw new PlanerkaClientError("transport_failure");
          if (response.status >= 400) throw new PlanerkaClientError("rejected");
          if (response.status !== (options.created ? 201 : 200))
            throw new PlanerkaClientError("invalid_response");
          const declared = response.headers.get("content-length");
          if (
            declared !== null &&
            (!/^\d+$/u.test(declared) || Number(declared) > MAX_BYTES)
          )
            throw new PlanerkaClientError("invalid_response");
          if (!reader) throw new PlanerkaClientError("invalid_response");
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const result = await reader.read();
            checkDeadline();
            if (result.done) break;
            size += result.value.byteLength;
            if (size > MAX_BYTES)
              throw new PlanerkaClientError("invalid_response");
            if (result.value.byteLength) chunks.push(result.value);
          }
          let raw: unknown;
          try {
            raw = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks, size),
              ),
            ) as unknown;
          } catch {
            throw new PlanerkaClientError("invalid_response");
          }
          const value = validate(schema, raw, "invalid_response");
          if (options.check && !options.check(value))
            throw new PlanerkaClientError("invalid_response");
          checkDeadline();
          return value;
        })(),
      ]);
    } catch (error) {
      const code =
        error instanceof PlanerkaClientError ? error.code : "transport_failure";
      if (
        mutation &&
        (code === "invalid_response" || code === "transport_failure")
      )
        throw new PlanerkaUnknownOutcomeError();
      throw new PlanerkaClientError(code);
    } finally {
      clearTimeout(timer);
      cancelBody();
      controller.abort();
    }
  }
  return {
    async getProfile() {
      return (await request("/me", planerkaEnvelope(planerkaProfileSchema)))
        .data;
    },
    async listEventTypes() {
      return (
        await request(
          "/event-types",
          planerkaEnvelope(planerkaEventTypesSchema),
        )
      ).data;
    },
    async listSlots(query) {
      const value = validate(planerkaSlotsQuerySchema, query, "invalid_input");
      return (
        await request(
          `/slots${queryString(value)}`,
          planerkaEnvelope(planerkaSlotsSchema),
          {
            slots: true,
            check: ({ data }) =>
              Object.entries(data).every(
                ([date, slots]) =>
                  date >= value.start &&
                  date <= value.end &&
                  slots.every((slot) => {
                    if (
                      value.format === "range" &&
                      !slot.end &&
                      value.duration === undefined
                    )
                      return false;
                    const parts = new Intl.DateTimeFormat("en", {
                      timeZone: value.timeZone,
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).formatToParts(new Date(slot.start));
                    const part = (type: string) =>
                      parts.find((item) => item.type === type)?.value;
                    return (
                      `${part("year")}-${part("month")}-${part("day")}` === date
                    );
                  }),
              ),
          },
        )
      ).data;
    },
    async listBookings(query = {}) {
      const value = validate(
        planerkaBookingsQuerySchema,
        query,
        "invalid_input",
      );
      const { data, pagination } = await request(
        `/bookings${queryString(value)}`,
        planerkaBookingPageSchema,
        {
          check: (page) =>
            page.data.length <= (value.take ?? 100) &&
            page.data.length <=
              Math.max(0, page.pagination.totalItems - (value.skip ?? 0)) &&
            page.pagination.remainingItems ===
              Math.max(
                0,
                page.pagination.totalItems -
                  (value.skip ?? 0) -
                  page.data.length,
              ),
        },
      );
      return { data, pagination };
    },
    async getBooking(uid) {
      const safeUid = validate(planerkaUidSchema, uid, "invalid_input");
      try {
        const { data } = await request(
          `/bookings/${safeUid}`,
          planerkaEnvelope(planerkaBookingSchema),
          { check: (value) => value.data.uid === safeUid },
        );
        return { kind: "found", booking: data };
      } catch (error) {
        if (error instanceof PlanerkaClientError && error.code === "not_found")
          return { kind: "missing" };
        throw error;
      }
    },
    async createBooking(command) {
      const value = validate(
        planerkaCreateBookingSchema,
        command,
        "invalid_input",
      );
      return (
        await request("/bookings", planerkaEnvelope(planerkaBookingSchema), {
          body: serialize(value),
          created: true,
          check: ({ data }) =>
            Date.parse(data.start) === Date.parse(value.start) &&
            (value.lengthInMinutes == null ||
              data.duration === value.lengthInMinutes) &&
            (value.eventTypeId === undefined
              ? data.eventType.slug === value.eventTypeSlug &&
                data.hosts.some((host) => host.username === value.username)
              : data.eventTypeId === value.eventTypeId) &&
            data.attendees.some(
              (attendee) =>
                attendee.name === value.attendee.name &&
                attendee.timeZone === value.attendee.timeZone &&
                (!value.attendee.email ||
                  attendee.email === value.attendee.email) &&
                (!value.attendee.phoneNumber ||
                  attendee.phone === value.attendee.phoneNumber) &&
                (!value.attendee.telegram ||
                  attendee.telegram === value.attendee.telegram),
            ) &&
            (data.status === "accepted" || data.status === "pending"),
        })
      ).data;
    },
    async cancelBooking(uid, command = {}) {
      const safeUid = validate(planerkaUidSchema, uid, "invalid_input");
      const value = validate(
        planerkaCancelBookingSchema,
        command,
        "invalid_input",
      );
      return (
        await request(
          `/bookings/${safeUid}/cancel`,
          planerkaEnvelope(planerkaBookingSchema),
          {
            body: serialize(value),
            check: ({ data }) =>
              data.uid === safeUid && data.status === "cancelled",
          },
        )
      ).data;
    },
  };
}
