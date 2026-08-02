import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DisabledPlanerkaAdapter,
  MAX_PROVIDER_SLOT_CANDIDATES,
  normalizeProviderSlots,
  type ProviderSlot,
} from "../../packages/integrations/src/index.js";

const now = new Date("2026-07-28T10:00:00.000Z");
const validSlot = (
  externalSlotId: string,
  overrides: Partial<ProviderSlot> = {},
): ProviderSlot => ({
  externalSlotId,
  expertExternalId: "expert-1",
  startsAt: "2026-07-30T10:00:00.000Z",
  endsAt: "2026-07-30T11:00:00.000Z",
  capacity: 1,
  observedAt: "2026-07-28T09:59:30.000Z",
  ...overrides,
});

describe("Planerka boundary", () => {
  it("filters malformed, stale, future-observed, and sub-24-hour slots", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("valid"),
        validSlot("stale", {
          observedAt: "2026-07-28T09:58:59.999Z",
        }),
        validSlot("future-observation", {
          observedAt: "2026-07-28T10:00:00.001Z",
        }),
        validSlot("sub-24-hour", {
          startsAt: "2026-07-29T09:59:59.999Z",
          endsAt: "2026-07-29T10:59:59.999Z",
        }),
        validSlot("non-canonical-offset", {
          startsAt: "2026-07-30T10:00:00.000+00:00",
        }),
        validSlot("non-canonical-precision", {
          observedAt: "2026-07-28T09:59:30Z",
        }),
        validSlot("invalid-calendar", {
          startsAt: "2026-02-30T10:00:00.000Z",
        }),
        validSlot("reversed", {
          startsAt: "2026-07-30T11:00:00.000Z",
          endsAt: "2026-07-30T10:00:00.000Z",
        }),
        validSlot("zero-capacity", { capacity: 0 }),
        validSlot("fractional-capacity", { capacity: 1.5 }),
        validSlot("", {}),
        validSlot("empty-expert", { expertExternalId: "" }),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["valid"]);
  });

  it("accepts exact freshness and 24-hour boundaries", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("boundary", {
          startsAt: "2026-07-29T10:00:00.000Z",
          endsAt: "2026-07-29T11:00:00.000Z",
          observedAt: "2026-07-28T09:59:00.000Z",
        }),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["boundary"]);
  });

  it("excludes every occurrence of duplicate external slot identifiers", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("duplicate", {
          startsAt: "2026-07-30T12:00:00.000Z",
          endsAt: "2026-07-30T13:00:00.000Z",
        }),
        validSlot("unique"),
        validSlot("duplicate"),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["unique"]);
  });

  it("lets malformed duplicate candidates poison an otherwise valid identifier", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("duplicate"),
        validSlot("duplicate", { capacity: 0 }),
        validSlot("unique"),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["unique"]);
  });

  it("enforces the authoritative PostgreSQL int32 capacity ceiling", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("max-capacity", { capacity: 2_147_483_647 }),
        validSlot("over-capacity", { capacity: 2_147_483_648 }),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["max-capacity"]);
  });

  it("rejects control characters and enforces identifier code-unit bounds", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("a".repeat(256)),
        validSlot("b".repeat(257)),
        validSlot("nul\u0000identifier"),
        validSlot("line\nbreak"),
        validSlot("del\u007fidentifier"),
        validSlot("next-line\u0085identifier"),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual([
      "a".repeat(256),
    ]);
  });

  it("sorts deterministically by UTC start then code-unit identifier order", () => {
    const slots = normalizeProviderSlots(
      [
        validSlot("ä"),
        validSlot("c", {
          startsAt: "2026-07-29T12:00:00.000Z",
          endsAt: "2026-07-29T13:00:00.000Z",
        }),
        validSlot("z"),
      ],
      now,
      60_000,
    );

    expect(slots.map((slot) => slot.externalSlotId)).toEqual(["c", "z", "ä"]);
  });

  it("accepts a dense array at the documented candidate bound", () => {
    const candidates = Array.from(
      { length: MAX_PROVIDER_SLOT_CANDIDATES },
      (_, index) =>
        index === MAX_PROVIDER_SLOT_CANDIDATES - 1
          ? validSlot("boundary")
          : null,
    ) as unknown as ProviderSlot[];

    expect(
      normalizeProviderSlots(candidates, now, 60_000).map(
        (slot) => slot.externalSlotId,
      ),
    ).toEqual(["boundary"]);
  });

  it("rejects an oversized array before inspecting its elements", () => {
    let inspected = 0;
    const candidates = new Array<ProviderSlot>(
      MAX_PROVIDER_SLOT_CANDIDATES + 1,
    );
    Object.defineProperty(candidates, "0", {
      enumerable: true,
      get() {
        inspected += 1;
        return validSlot("must-not-be-read");
      },
    });

    expect(normalizeProviderSlots(candidates, now, 60_000)).toEqual([]);
    expect(inspected).toBe(0);
  });

  it("rejects non-array iterables without consuming them", () => {
    let iterations = 0;
    const candidates = {
      [Symbol.iterator]() {
        iterations += 1;
        throw new Error("must not iterate");
      },
    } as unknown as readonly ProviderSlot[];

    expect(normalizeProviderSlots(candidates, now, 60_000)).toEqual([]);
    expect(iterations).toBe(0);
  });

  it("rejects proxy arrays before triggering proxy traps", () => {
    let trapCalls = 0;
    const candidates = new Proxy([validSlot("proxy")], {
      get(target, property, receiver) {
        trapCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(normalizeProviderSlots(candidates, now, 60_000)).toEqual([]);
    expect(trapCalls).toBe(0);
  });

  it("rejects proxy candidates and field accessors without triggering traps", () => {
    let proxyTrapCalls = 0;
    const proxyCandidate = new Proxy(validSlot("proxy-candidate"), {
      get(target, property, receiver) {
        proxyTrapCalls += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(normalizeProviderSlots([proxyCandidate], now, 60_000)).toEqual([]);
    expect(proxyTrapCalls).toBe(0);

    let fieldReads = 0;
    const accessorCandidate = validSlot("accessor-candidate");
    Object.defineProperty(accessorCandidate, "capacity", {
      enumerable: true,
      get() {
        fieldReads += 1;
        return 1;
      },
    });
    expect(normalizeProviderSlots([accessorCandidate], now, 60_000)).toEqual(
      [],
    );
    expect(fieldReads).toBe(0);
  });

  it("rejects sparse arrays and accessor elements without reading accessors", () => {
    const sparse = new Array<ProviderSlot>(2);
    sparse[1] = validSlot("sparse");
    expect(normalizeProviderSlots(sparse, now, 60_000)).toEqual([]);

    let accessorReads = 0;
    const accessor = new Array<ProviderSlot>(1);
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return validSlot("accessor");
      },
    });
    expect(normalizeProviderSlots(accessor, now, 60_000)).toEqual([]);
    expect(accessorReads).toBe(0);
  });

  it.each([
    [new Date(Number.NaN), 60_000],
    [now, 0],
    [now, -1],
    [now, Number.NaN],
    [now, Number.POSITIVE_INFINITY],
    [now, 1.5],
  ])("fails closed for invalid now/maxAge inputs", (invalidNow, maxAgeMs) => {
    expect(
      normalizeProviderSlots([validSlot("valid")], invalidNow, maxAgeMs),
    ).toEqual([]);
  });

  it("cannot call any provider method before contract approval", async () => {
    const adapter = new DisabledPlanerkaAdapter();
    const calls = [
      adapter.listSlots({
        from: "2026-07-29T10:00:00.000Z",
        to: "2026-08-01T10:00:00.000Z",
      }),
      adapter.reserve({
        idempotencyKey: "reserve-1",
        externalSlotId: "slot-1",
        externalReservationId: "reservation-1",
      }),
      adapter.confirm({
        idempotencyKey: "confirm-1",
        externalReservationId: "reservation-1",
      }),
      adapter.cancel({
        idempotencyKey: "cancel-1",
        externalReservationId: "reservation-1",
      }),
      adapter.getReservation("reservation-1"),
    ];

    for (const call of calls) {
      await expect(call).rejects.toMatchObject({
        message: "Planerka integration is disabled",
      });
    }
  });

  it.each([
    ["booking-created", "applied"],
    ["booking-duplicate", "duplicate"],
    ["webhook-auth-unconfirmed", "disabled"],
    ["rate-limit-429", "retryable"],
    ["timeout-before-send", "not_applied"],
    ["timeout-after-send", "unknown_outcome"],
    ["invalid-schema", "invalid_schema"],
  ])("parses sanitized Planerka fixture %s", (name, expectedOutcome) => {
    const value = JSON.parse(
      readFileSync(`tests/fixtures/planerka/${name}.json`, "utf8"),
    ) as {
      sanitized: boolean;
      source: string;
      captureDate: string;
      expectedOutcome: string;
    };
    expect(value).toMatchObject({
      sanitized: true,
      source: "contract-hypothesis",
      captureDate: "2026-07-29",
      expectedOutcome,
    });
  });
});
