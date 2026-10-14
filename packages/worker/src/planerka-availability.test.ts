import { describe, expect, it } from "vitest";
import { createPlanerkaClient } from "@ii-tonya/integrations";
import { runPlanerkaAvailabilityOnce } from "./index.js";
import type { PlanerkaAvailabilityClaim } from "@ii-tonya/db";
import { PlanerkaAvailabilityBusyError } from "@ii-tonya/db";

const claim: PlanerkaAvailabilityClaim = {
  serviceId: "00000000-0000-4000-8000-000000000001",
  accountId: 42,
  eventTypeId: 7,
  durationMinutes: 60,
  timeZone: "UTC",
  verifiedAt: "2026-10-01T00:00:00.000Z",
  leaseToken: "00000000-0000-4000-8000-000000000002",
  observedAt: "2026-10-13T12:00:00.000Z",
  windowStart: "2026-10-14T00:00:00.000Z",
  windowEnd: "2026-10-21T00:00:00.000Z",
};
const event = {
  id: 7,
  ownerId: 42,
  title: "Synthetic",
  slug: "fixture",
  length: 60,
  lengthInMinutes: 60,
  hidden: false,
  position: 0,
  locations: [],
  price: 0,
  currency: "RUB",
  requiresConfirmation: false,
  disableGuests: true,
  minimumBookingNotice: 0,
  beforeEventBuffer: 0,
  afterEventBuffer: 0,
};
async function scenario(
  options: {
    slots?: unknown;
    profile?: object;
    event?: object;
    types?: unknown;
    status?: number;
    oversized?: boolean;
    admitted?: boolean;
    noClaim?: boolean;
    publish?: boolean;
    busy?: "claim" | "publish" | "defer";
    databaseFailure?: boolean;
  } = {},
) {
  const paths: string[] = [];
  const published: unknown[] = [];
  const deferred: string[] = [];
  const waits: number[] = [];
  let admissions = 0;
  const result = await runPlanerkaAvailabilityOnce({
    accountId: 42,
    repository: {
      async claim() {
        if (options.busy === "claim") throw new PlanerkaAvailabilityBusyError();
        if (options.databaseFailure)
          throw new Error("database_integrity_failure");
        return options.noClaim ? undefined : claim;
      },
      async publish(_claim, slots) {
        if (options.busy === "publish")
          throw new PlanerkaAvailabilityBusyError();
        published.push(slots);
        return options.publish ?? true;
      },
      async defer(_claim, reason) {
        if (options.busy === "defer") throw new PlanerkaAvailabilityBusyError();
        deferred.push(reason);
        return true;
      },
    },
    admitRequest: async () => {
      admissions++;
      return options.admitted ?? true;
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
    client: createPlanerkaClient(
      { apiKey: "cal_synthetic", timeoutMs: 5000 },
      async (url, init) => {
        expect(init.method).toBe("GET");
        expect(init.redirect).toBe("error");
        expect(new URL(url).origin).toBe("https://planerka.app");
        paths.push(url);
        if (url.includes("/slots")) {
          expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
            eventTypeId: "7",
            start: "2026-10-14",
            end: "2026-10-21",
            timeZone: "UTC",
            duration: "60",
            format: "range",
          });
          if (options.oversized) return new Response("x".repeat(262145));
          if (options.status)
            return new Response("", { status: options.status });
        }
        const data = url.endsWith("/me")
          ? { id: 42, timeZone: "UTC", weekStart: "Monday", ...options.profile }
          : url.endsWith("/event-types")
            ? (options.types ?? [{ ...event, ...options.event }])
            : Object.hasOwn(options, "slots")
              ? options.slots
              : {
                  "2026-10-15": [
                    {
                      start: "2026-10-15T10:00:00Z",
                      end: "2026-10-15T11:00:00Z",
                    },
                  ],
                };
        return Response.json({ status: "success", data });
      },
    ),
  });
  return { result, paths, published, deferred, waits, admissions };
}
it("publishes normalized provider times only after three admitted authenticated GETs", async () => {
  const s = await scenario();
  expect(s.result).toEqual({ processed: 1, published: 1 });
  expect(s.published).toEqual([
    [
      {
        startsAt: "2026-10-15T10:00:00.000Z",
        endsAt: "2026-10-15T11:00:00.000Z",
      },
    ],
  ]);
  expect(s.admissions).toBe(3);
});
it("deduplicates equal instants and derives a missing or null end from approved duration", async () => {
  const s = await scenario({
    slots: {
      "2026-10-15": [
        { start: "2026-10-15T10:00:00Z" },
        { start: "2026-10-15T12:00:00+02:00", end: null },
      ],
    },
  });
  expect(s.result.published).toBe(1);
  expect(s.published).toEqual([
    [
      {
        startsAt: "2026-10-15T10:00:00.000Z",
        endsAt: "2026-10-15T11:00:00.000Z",
      },
    ],
  ]);
});
it("accepts an inclusive end bucket without publishing that extra day", async () => {
  const s = await scenario({
    slots: {
      "2026-10-21": [
        { start: "2026-10-21T10:00:00Z", end: "2026-10-21T11:00:00Z" },
      ],
    },
  });
  expect(s.result).toEqual({ processed: 1, published: 0 });
  expect(s.published).toEqual([[]]);
});
it("publishes a valid empty snapshot", async () => {
  expect((await scenario({ slots: {} })).published).toEqual([[]]);
});
it("omits a valid interval crossing the final UTC boundary without poisoning valid choices", async () => {
  const s = await scenario({
    slots: {
      "2026-10-15": [
        { start: "2026-10-15T10:00:00Z", end: "2026-10-15T11:00:00Z" },
      ],
      "2026-10-20": [
        { start: "2026-10-20T23:30:00Z", end: "2026-10-21T00:30:00Z" },
      ],
    },
  });
  expect(s.result).toEqual({ processed: 1, published: 1 });
  expect(s.published).toEqual([
    [
      {
        startsAt: "2026-10-15T10:00:00.000Z",
        endsAt: "2026-10-15T11:00:00.000Z",
      },
    ],
  ]);
});
describe("rejects invalid provider facts without publishing freshness", () => {
  it.each([
    { profile: { id: 99 } },
    { profile: { timeZone: "Europe/Moscow" } },
    ...[
      { ownerId: 99 },
      { length: 30 },
      { lengthInMinutes: 30 },
      { hidden: true },
      { requiresConfirmation: true },
      { price: 1 },
      { schedulingType: "COLLECTIVE" },
      { seatsPerTimeSlot: 2 },
    ].map((event) => ({ event })),
    { types: [event, event] },
    { types: [] },
    { slots: { "2026-10-15": [{ start: "2026-10-16T10:00:00Z" }] } },
    { slots: { "2026-10-32": [] } },
    { slots: { "2026-10-22": [] } },
    {
      slots: {
        "2026-10-15": [
          { start: "2026-10-15T10:00:00Z", end: "2026-10-15T10:30:00Z" },
        ],
      },
    },
    {
      slots: {
        "2026-10-15": [
          { start: "2026-10-15T10:00:00Z" },
          { start: "2026-10-15T10:00:00Z", end: "2026-10-15T12:00:00Z" },
        ],
      },
    },
    { slots: null },
    { oversized: true },
    { status: 403 },
    { status: 500 },
    { status: 429 },
  ])("rejects %j", async (options) => {
    const s = await scenario(options);
    expect(s.published).toEqual([]);
    expect(s.result).toMatchObject({ processed: 1, published: 0 });
    expect(s.deferred).toHaveLength(1);
  });
});
it("exhausts only three admissions and leaves freshness alone", async () => {
  const s = await scenario({ admitted: false });
  expect(s.admissions).toBe(3);
  expect(s.waits).toEqual([2100, 2100]);
  expect(s.paths).toEqual([]);
  expect(s.result.reason).toBe("account_rate_limit");
  expect(s.published).toEqual([]);
});
it("makes no provider calls without an eligible mapping", async () => {
  const s = await scenario({ noClaim: true });
  expect(s.paths).toEqual([]);
  expect(s.result).toEqual({ processed: 0, published: 0 });
});
it("reports a fenced publication without claiming success", async () => {
  expect((await scenario({ publish: false })).result).toEqual({
    processed: 1,
    published: 0,
    reason: "stale_claim",
  });
});
it.each(["claim", "publish", "defer"] as const)(
  "returns a fixed non-success outcome on %s contention",
  async (busy) => {
    const s = await scenario({
      busy,
      ...(busy === "defer" ? { status: 500 } : {}),
    });
    expect(s.result).toEqual({
      processed: busy === "claim" ? 0 : 1,
      published: 0,
      reason: "database_busy",
    });
  },
);
it("does not turn unrelated database failures into background retries", async () => {
  await expect(scenario({ databaseFailure: true })).rejects.toThrow(
    "database_integrity_failure",
  );
});
it("rejects range slots without ends unless an explicit valid duration was requested", async () => {
  let calls = 0;
  const client = createPlanerkaClient({ apiKey: "cal_synthetic" }, async () => {
    calls++;
    return Response.json({
      status: "success",
      data: { "2026-10-15": [{ start: "2026-10-15T10:00:00Z" }] },
    });
  });
  const query = {
    eventTypeId: 7,
    start: "2026-10-14",
    end: "2026-10-21",
    timeZone: "UTC",
    format: "range" as const,
  };
  await expect(client.listSlots(query)).rejects.toMatchObject({
    code: "invalid_response",
  });
  await expect(
    client.listSlots({ ...query, duration: 0 }),
  ).rejects.toMatchObject({ code: "invalid_input" });
  expect(calls).toBe(1);
  await expect(client.listSlots({ ...query, duration: 60 })).resolves.toEqual({
    "2026-10-15": [{ start: "2026-10-15T10:00:00Z" }],
  });
});
