import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlanerkaClient } from "./client.js";

const key = "cal_offline_test_key";
const start = "2050-09-05T09:00:00.000Z";
const command = {
  eventTypeId: 7,
  start,
  attendee: {
    name: "Synthetic Guest",
    email: "guest@example.test",
    timeZone: "Europe/Moscow",
  },
};
const booking = {
  id: 1,
  uid: "booking-1",
  title: "Test",
  description: "",
  hosts: [
    {
      id: 1,
      name: "Synthetic Host",
      email: "host@example.test",
      displayEmail: "host@example.test",
      username: "synthetic",
      timeZone: "UTC",
    },
  ],
  status: "accepted",
  start,
  end: "2050-09-05T09:30:00.000Z",
  duration: 30,
  eventTypeId: 7,
  eventType: { id: 7, slug: "test" },
  location: "",
  meetingUrl: "",
  absentHost: false,
  createdAt: start,
  updatedAt: start,
  attendees: [
    {
      name: "Synthetic Guest",
      email: "guest@example.test",
      displayEmail: "guest@example.test",
      timeZone: "Europe/Moscow",
      absent: false,
    },
  ],
  bookingFieldsResponses: {},
};
const eventType = {
  id: 7,
  ownerId: 1,
  title: "Test",
  slug: "test",
  lengthInMinutes: 30,
  length: 30,
  hidden: false,
  position: 0,
  locations: [],
  price: 0,
  currency: "rub",
  requiresConfirmation: false,
  disableGuests: false,
  minimumBookingNotice: 0,
  beforeEventBuffer: 0,
  afterEventBuffer: 0,
};
const pagination = {
  totalItems: 2,
  remainingItems: 1,
  returnedItems: 1,
  itemsPerPage: 1,
  currentPage: 1,
  totalPages: 2,
  hasNextPage: true,
  hasPreviousPage: false,
};
const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ status: "success", data }), { status });
const setup = (response: () => Response | Promise<Response>) => {
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    void url;
    void init;
    return response();
  });
  return {
    transport,
    client: createPlanerkaClient({ apiKey: key, timeoutMs: 100 }, transport),
  };
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Planerka REST client", () => {
  it("binds creation to the requested length even when the returned booking is internally valid", async () => {
    const { client, transport } = setup(() => ok(booking, 201));
    await expect(
      client.createBooking({ ...command, lengthInMinutes: 60 }),
    ).rejects.toMatchObject({ code: "unknown_outcome" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects booking duration inconsistent with its timestamps on reads and creation", async () => {
    const inconsistent = { ...booking, duration: 60 };
    await expect(
      setup(() => ok(inconsistent)).client.getBooking("booking-1"),
    ).rejects.toMatchObject({ code: "invalid_response" });
    const { client, transport } = setup(() => ok(inconsistent, 201));
    await expect(
      client.createBooking({ ...command, lengthInMinutes: 60 }),
    ).rejects.toMatchObject({ code: "unknown_outcome" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    {
      ...booking,
      start: "2050-09-05T10:00:00.000Z",
      end: "2050-09-05T10:30:00.000Z",
    },
    { ...booking, eventTypeId: 8, eventType: { id: 8, slug: "other" } },
  ])(
    "rejects internally valid creation responses for the wrong start or event type (%j)",
    async (value) => {
      // A read proves this fixture is valid independently of creation-command binding.
      await expect(
        setup(() => ok(value)).client.getBooking("booking-1"),
      ).resolves.toEqual({ kind: "found", booking: value });
      const { client, transport } = setup(() => ok(value, 201));
      await expect(client.createBooking(command)).rejects.toMatchObject({
        code: "unknown_outcome",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("allows empty participant lists on reads", async () => {
    const value = { ...booking, hosts: [], attendees: [] };
    await expect(
      setup(() => ok(value)).client.getBooking("booking-1"),
    ).resolves.toEqual({ kind: "found", booking: value });
  });
  it.each([undefined, null])(
    "requires an end for range slots (%s)",
    async (end) => {
      const { client } = setup(() => ok({ "2050-09-05": [{ start, end }] }));
      await expect(
        client.listSlots({
          eventTypeId: 7,
          start: "2050-09-05",
          end: "2050-09-05",
          format: "range",
          timeZone: "UTC",
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    },
  );
  it("allows start-only slots for time format", async () => {
    const slots = { "2050-09-05": [{ start }] };
    await expect(
      setup(() => ok(slots)).client.listSlots({
        eventTypeId: 7,
        start: "2050-09-05",
        end: "2050-09-05",
        format: "time",
        timeZone: "UTC",
      }),
    ).resolves.toEqual(slots);
  });
  it("explicitly sends UTC when timezone is omitted and groups by that timezone", async () => {
    const query = { eventTypeId: 7, start: "2050-09-05", end: "2050-09-05" };
    // The timestamp's literal date differs from its date in requested UTC.
    const slots = { "2050-09-05": [{ start: "2050-09-06T01:00:00+03:00" }] };
    const { client, transport } = setup(() => ok(slots));
    await expect(client.listSlots(query)).resolves.toEqual(slots);
    expect(
      new URL(transport.mock.calls[0]![0]).searchParams.get("timeZone"),
    ).toBe("UTC");
    await expect(
      setup(() =>
        ok({ "2050-09-05": [{ start: "2050-09-05T01:00:00+03:00" }] }),
      ).client.listSlots(query),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it.each([
    {
      query: { take: 1, skip: 0 },
      data: [booking, { ...booking, id: 2, uid: "booking-2" }],
      meta: {
        totalItems: 2,
        remainingItems: 0,
        returnedItems: 2,
        itemsPerPage: 2,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    },
    {
      query: { take: 1, skip: 2 },
      data: [booking],
      meta: {
        totalItems: 2,
        remainingItems: 0,
        returnedItems: 1,
        itemsPerPage: 1,
        currentPage: 3,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    },
  ])(
    "rejects pages exceeding requested take or containing items past total ($query)",
    async ({ query, data, meta }) => {
      const { client, transport } = setup(
        () =>
          new Response(
            JSON.stringify({ status: "success", data, pagination: meta }),
          ),
      );
      await expect(client.listBookings(query)).rejects.toMatchObject({
        code: "invalid_response",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    {
      label: "nonzero skip",
      query: { take: 1, skip: 1 },
      data: [booking],
      meta: {
        totalItems: 3,
        remainingItems: 1,
        returnedItems: 1,
        itemsPerPage: 1,
        currentPage: 2,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    },
    {
      label: "final partial page",
      query: { take: 2, skip: 2 },
      data: [booking],
      meta: {
        totalItems: 3,
        remainingItems: 0,
        returnedItems: 1,
        itemsPerPage: 2,
        currentPage: 2,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    },
    {
      label: "empty result",
      query: { take: 2, skip: 0 },
      data: [],
      meta: {
        totalItems: 0,
        remainingItems: 0,
        returnedItems: 0,
        itemsPerPage: 2,
        currentPage: 1,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    },
    {
      label: "empty past total",
      query: { take: 1, skip: 3 },
      data: [],
      meta: {
        totalItems: 2,
        remainingItems: 0,
        returnedItems: 0,
        itemsPerPage: 1,
        currentPage: 4,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
    },
  ])(
    "preserves valid $label page without implicit fetching",
    async ({ query, data, meta }) => {
      // Page metadata is a fixture, not a client-derived currentPage formula.
      const { client, transport } = setup(
        () =>
          new Response(
            JSON.stringify({ status: "success", data, pagination: meta }),
          ),
      );
      await expect(client.listBookings(query)).resolves.toEqual({
        data,
        pagination: meta,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      const params = new URL(transport.mock.calls[0]![0]).searchParams;
      expect(params.get("skip")).toBe(String(query.skip));
      expect(params.get("take")).toBe(String(query.take));
    },
  );
  it.each(["array", "record"] as const)(
    "bounds %s guests to 100 before transport",
    async (shape) => {
      const emails = Array.from(
        { length: 101 },
        (_, index) => `guest${index}@example.test`,
      );
      const guests =
        shape === "array"
          ? emails
          : Object.fromEntries(
              emails.map((email, index) => [String(index), email]),
            );
      const { client, transport } = setup(() => ok(booking, 201));
      await expect(
        client.createBooking({ ...command, guests }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("accepts the 100-guest record boundary", async () => {
    const guests = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        String(index),
        `guest${index}@example.test`,
      ]),
    );
    const { client, transport } = setup(() => ok(booking, 201));
    await expect(client.createBooking({ ...command, guests })).resolves.toEqual(
      booking,
    );
    expect(
      JSON.parse(transport.mock.calls[0]![1].body as string).guests,
    ).toEqual(guests);
  });
  it("rejects oversized outgoing metadata before any request", async () => {
    const { client, transport } = setup(() => ok(booking, 201));
    await expect(
      client.createBooking({
        ...command,
        metadata: { payload: "x".repeat(262145) },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([408, 500, 502, 503])(
    "preserves uncertain cancellation on HTTP %s without retry",
    async (status) => {
      const { client, transport } = setup(() => new Response(null, { status }));
      await expect(client.cancelBooking("booking-1")).rejects.toMatchObject({
        code: "unknown_outcome",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes cancellation network failure without retry", async () => {
    const { client, transport } = setup(() => {
      throw new Error(`${key} guest@example.test`);
    });
    const error: unknown = await client
      .cancelBooking("booking-1")
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "unknown_outcome",
      message: "planerka_unknown_outcome",
    });
    expect(JSON.stringify(error)).not.toContain(key);
    expect(String(error)).not.toContain("guest@example.test");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("preserves uncertain cancellation on malformed success without retry", async () => {
    const { client, transport } = setup(() => new Response("not JSON"));
    await expect(client.cancelBooking("booking-1")).rejects.toMatchObject({
      code: "unknown_outcome",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("bounds cancellation fetch and body stalls without retry", async () => {
    vi.useFakeTimers();
    for (const response of [
      () => new Promise<Response>(() => {}),
      () => new Response(new ReadableStream()),
    ]) {
      const { client, transport } = setup(response);
      const pending = expect(
        client.cancelBooking("booking-1"),
      ).rejects.toMatchObject({ code: "unknown_outcome" });
      await vi.advanceTimersByTimeAsync(101);
      await pending;
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
    }
  });
  it("rejects creation responses for another attendee or host", async () => {
    for (const attendee of [
      { ...booking.attendees[0], email: "wrong@example.test" },
      { ...booking.attendees[0], name: "Wrong guest" },
    ]) {
      await expect(
        setup(() =>
          ok({ ...booking, attendees: [attendee] }, 201),
        ).client.createBooking(command),
      ).rejects.toMatchObject({ code: "unknown_outcome" });
    }
    await expect(
      setup(() => ok(booking, 201)).client.createBooking({
        start,
        eventTypeSlug: "test",
        username: "wrong",
        attendee: command.attendee,
      }),
    ).rejects.toMatchObject({ code: "unknown_outcome" });
  });
  it("rejects contradictory pagination without fetching another page", async () => {
    for (const patch of [
      { totalItems: 0 },
      { totalPages: 0 },
      { hasNextPage: false },
      { remainingItems: 0, hasNextPage: false },
      { returnedItems: 2 },
    ]) {
      const { client, transport } = setup(
        () =>
          new Response(
            JSON.stringify({
              status: "success",
              data: [booking],
              pagination: { ...pagination, ...patch },
            }),
          ),
      );
      await expect(client.listBookings()).rejects.toMatchObject({
        code: "invalid_response",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("validates slot grouping in the requested timezone and requested range", async () => {
    const query = {
      eventTypeId: 7,
      start: "2050-09-05",
      end: "2050-09-07",
      timeZone: "Europe/Moscow",
    };
    const valid = { "2050-09-05": [{ start: "2050-09-04T22:00:00Z" }] };
    expect(await setup(() => ok(valid)).client.listSlots(query)).toEqual(valid);
    for (const data of [
      { "2050-09-05": [{ start: "2050-10-05T09:00:00Z" }] },
      { "2050-09-08": [] },
    ]) {
      await expect(
        setup(() => ok(data)).client.listSlots(query),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });
  it("rejects malformed JSON, success envelopes and declared oversized responses", async () => {
    for (const response of [
      () => new Response("not JSON", { status: 201 }),
      () =>
        new Response(JSON.stringify({ status: "error", data: booking }), {
          status: 201,
        }),
      () =>
        new Response("{}", {
          status: 201,
          headers: { "content-length": "262145" },
        }),
      () => ok(booking, 200),
    ])
      await expect(
        setup(response).client.createBooking(command),
      ).rejects.toMatchObject({ code: "unknown_outcome" });
  });
  it("enforces elapsed deadline even when ready stream reads starve timer callbacks", async () => {
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const cancel = vi.fn();
    const { client } = setup(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              elapsed += 101;
              controller.enqueue(new Uint8Array());
            },
            cancel,
          }),
        ),
    );
    await expect(client.createBooking(command)).rejects.toMatchObject({
      code: "unknown_outcome",
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("supports slug selection and optional documented creation fields", async () => {
    const { client, transport } = setup(() => ok(booking, 201));
    const payload = {
      start,
      eventTypeSlug: "test",
      username: "synthetic",
      attendee: command.attendee,
      guests: ["other@example.test"],
      lengthInMinutes: 30,
      metadata: { correlation: "synthetic" },
      bookingFieldsResponses: { custom: "synthetic" },
    };
    await client.createBooking(payload);
    expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual(
      payload,
    );
  });
  it("uses the fixed origin, bearer, redirect rejection and profile version", async () => {
    const { client, transport } = setup(() =>
      ok({ id: 1, timeZone: "UTC", weekStart: "Monday" }),
    );
    expect(await client.getProfile()).toEqual({
      id: 1,
      timeZone: "UTC",
      weekStart: "Monday",
    });
    expect(transport).toHaveBeenCalledWith(
      "https://planerka.app/rest/v2/me",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: `Bearer ${key}`,
          "cal-api-version": "2024-08-13",
        }),
      }),
    );
  });
  it("normalizes keyed event lists and validates every item", async () => {
    const { client } = setup(() => ok({ 7: eventType }));
    expect(await client.listEventTypes()).toEqual([eventType]);
    await expect(
      setup(() => ok([eventType, { id: 2 }])).client.listEventTypes(),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("serializes bounded slot dates with the slots-specific version", async () => {
    const slots = {
      "2050-09-05": [{ start, end: "2050-09-05T09:30:00.000Z" }],
    };
    const { client, transport } = setup(() => ok(slots));
    expect(
      await client.listSlots({
        eventTypeId: 7,
        start: "2050-09-05",
        end: "2050-09-07",
        timeZone: "UTC",
        format: "range",
      }),
    ).toEqual(slots);
    const [url, init] = transport.mock.calls[0]!;
    expect(new URL(url).searchParams.get("eventTypeId")).toBe("7");
    expect(new URL(url).searchParams.get("end")).toBe("2050-09-07");
    expect(init.headers).toMatchObject({ "cal-api-version": "2024-09-04" });
  });
  it("returns one validated booking page without fetching the next page", async () => {
    const { client, transport } = setup(
      () =>
        new Response(
          JSON.stringify({
            status: "success",
            data: { 0: booking },
            pagination,
          }),
        ),
    );
    expect(
      await client.listBookings({
        take: 1,
        skip: 0,
        status: "upcoming,past",
        sortStart: "asc",
      }),
    ).toEqual({ data: [booking], pagination });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(
      new URL(transport.mock.calls[0]![0]).searchParams.get("status"),
    ).toBe("upcoming,past");
  });
  it("creates exactly once with the documented body and preserves pending status", async () => {
    const { client, transport } = setup(() =>
      ok({ ...booking, status: "pending" }, 201),
    );
    expect((await client.createBooking(command)).status).toBe("pending");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toBe(
      "https://planerka.app/rest/v2/bookings",
    );
    expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual(
      command,
    );
  });
  it("checks lookup identity and returns a typed missing result for 404", async () => {
    expect(
      await setup(() => ok(booking)).client.getBooking("booking-1"),
    ).toEqual({ kind: "found", booking });
    expect(
      await setup(() => new Response(null, { status: 404 })).client.getBooking(
        "absent",
      ),
    ).toEqual({ kind: "missing" });
    await expect(
      setup(() => ok(booking)).client.getBooking("different"),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("supports repeated cancellation and checks cancelled identity/status", async () => {
    const { client, transport } = setup(() =>
      ok({ ...booking, status: "cancelled" }),
    );
    await client.cancelBooking("booking-1", {
      cancellationReason: "Synthetic cancellation",
    });
    await client.cancelBooking("booking-1");
    expect(transport.mock.calls[0]![0]).toBe(
      "https://planerka.app/rest/v2/bookings/booking-1/cancel",
    );
    expect(JSON.parse(transport.mock.calls[0]![1].body as string)).toEqual({
      cancellationReason: "Synthetic cancellation",
    });
    expect(transport).toHaveBeenCalledTimes(2);
    for (const value of [
      booking,
      { ...booking, uid: "wrong", status: "cancelled" },
    ]) {
      await expect(
        setup(() => ok(value)).client.cancelBooking("booking-1"),
      ).rejects.toMatchObject({ code: "unknown_outcome" });
    }
  });
  it.each([
    [401, "access_denied"],
    [403, "access_denied"],
    [409, "conflict"],
    [429, "rate_limited"],
    [400, "rejected"],
  ])(
    "classifies HTTP %s without retry or provider diagnostics",
    async (status, code) => {
      const { client, transport } = setup(
        () =>
          new Response(`${key} guest@example.test`, {
            status: status as number,
          }),
      );
      const error: unknown = await client
        .createBooking(command)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain(key);
      expect(JSON.stringify(error)).not.toContain("guest@example.test");
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([500, 502, 503])(
    "preserves unknown mutation outcome on %s",
    async (status) => {
      const { client, transport } = setup(() => new Response(null, { status }));
      await expect(client.createBooking(command)).rejects.toMatchObject({
        code: "unknown_outcome",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes thrown network errors and never repeats creation", async () => {
    const { client, transport } = setup(() => {
      throw new Error(`${key} guest@example.test`);
    });
    await expect(client.createBooking(command)).rejects.toMatchObject({
      code: "unknown_outcome",
      message: "planerka_unknown_outcome",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(client.getProfile()).rejects.toMatchObject({
      code: "transport_failure",
    });
  });
  it.each([
    null,
    {},
    { ...booking, uid: "" },
    { ...booking, eventTypeId: 8 },
    { ...booking, start: "invalid" },
  ])("treats malformed creation success as unknown (%j)", async (value) => {
    await expect(
      setup(() => ok(value, 201)).client.createBooking(command),
    ).rejects.toMatchObject({ code: "unknown_outcome" });
  });
  it("rejects invalid slots and invalid page metadata", async () => {
    for (const value of [
      { nonsense: [] },
      { "2050-09-05": [{}] },
      { "2050-09-05": [{ start: "bad" }] },
    ]) {
      await expect(
        setup(() => ok(value)).client.listSlots({
          eventTypeId: 7,
          start: "2050-09-05",
          end: "2050-09-07",
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
    await expect(
      setup(() => ok([booking])).client.listBookings(),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("rejects unsafe keys and commands locally with sanitized errors", async () => {
    const { client, transport } = setup(() => ok(booking));
    for (const apiKey of ["", "bad", "cal_bad\r\nx: y"])
      expect(() => createPlanerkaClient({ apiKey }, transport)).toThrow(
        "planerka_invalid_input",
      );
    for (const uid of ["", "..", "../me", "x?key=y", "x\n"])
      await expect(client.getBooking(uid)).rejects.toMatchObject({
        code: "invalid_input",
      });
    for (const patch of [
      { start: "2050-02-30" },
      { end: "2051-09-05" },
      { eventTypeId: -1 },
      { timeZone: "bad/zone" },
    ]) {
      await expect(
        client.listSlots({
          eventTypeId: 7,
          start: "2050-09-05",
          end: "2050-09-07",
          ...patch,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      client.createBooking({
        ...command,
        attendee: { ...command.attendee, email: "bad" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.listBookings({ take: 0 })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it("requests redirect rejection and classifies an injected 302 as unknown", async () => {
    const { client, transport } = setup(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example" },
        }),
    );
    await expect(client.createBooking(command)).rejects.toMatchObject({
      code: "unknown_outcome",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![1].redirect).toBe("error");
  });
  it("bounds actual streamed bytes and cancels oversized bodies", async () => {
    const cancel = vi.fn();
    const { client } = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(262145));
            },
            cancel,
          }),
        ),
    );
    await expect(client.createBooking(command)).rejects.toMatchObject({
      code: "unknown_outcome",
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("applies the total deadline to both hung fetch and stalled body", async () => {
    vi.useFakeTimers();
    for (const response of [
      () => new Promise<Response>(() => {}),
      () => new Response(new ReadableStream()),
    ]) {
      const { client, transport } = setup(response);
      const pending = expect(
        client.createBooking(command),
      ).rejects.toMatchObject({ code: "unknown_outcome" });
      await vi.advanceTimersByTimeAsync(101);
      await pending;
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
    }
  });
});
