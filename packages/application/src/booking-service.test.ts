import { describe, expect, it, vi } from "vitest";

import { createBookingService } from "./booking-service.js";
import { bookingFixture } from "./booking-service.testkit.js";

describe("booking workflows", () => {
  it("reserves locally first and emits one free expert request plus audit", async () => {
    const deps = bookingFixture();

    const result = await createBookingService(deps).reserve(
      deps.reserveCommand,
    );

    expect(result).toMatchObject({ kind: "reserved", version: 1 });
    expect(deps.outbox.topics()).toEqual([
      "planerka.reserve",
      "telegram.reservation_request",
    ]);
    expect(deps.outbox.allFree()).toBe(true);
    expect(deps.audit.actions()).toEqual(["reservation.created"]);
  });

  it("confirms the expected version once and emits one free client notification", async () => {
    const deps = bookingFixture({ status: "reserved", version: 1 });
    const service = createBookingService(deps);

    const first = await service.confirmByExpert({
      reservationId: deps.reservationId,
      expertId: deps.expertId,
      callbackTokenHash: deps.callbackTokenHash,
      expectedVersion: 1,
      correlationId: "confirm-1",
    });

    expect(first).toMatchObject({ status: "booked", version: 2 });
    await expect(
      service.confirmByExpert({
        reservationId: deps.reservationId,
        expertId: deps.expertId,
        callbackTokenHash: deps.callbackTokenHash,
        expectedVersion: 1,
        correlationId: "confirm-2",
      }),
    ).rejects.toThrow("Stale reservation version");
    expect(deps.outbox.topics()).toEqual([
      "planerka.confirm",
      "client.booking_confirmed",
    ]);
    expect(deps.outbox.allFree()).toBe(true);
  });

  it("limits expert schedule output to owned appointments and consented notes", async () => {
    const deps = bookingFixture();

    const view = await createBookingService(deps).getExpertSchedule({
      expertId: deps.expertId,
      telegramUserId: deps.telegramUserId,
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
      timezone: "Europe/Moscow",
    });

    expect(view.appointments).toHaveLength(1);
    expect(view.appointments[0]).not.toHaveProperty("rawConversation");
    expect(view.appointments[0]).not.toHaveProperty("unconsentedProfile");
    expect(view.appointments[0]).not.toHaveProperty("expertNote");
  });

  it("uses the authoritative clock for slot search and reservation", async () => {
    const deps = bookingFixture();
    const search = vi.spyOn(deps.repository, "searchSlots");
    const reserve = vi.spyOn(deps.repository, "reserveAndPublish");
    const service = createBookingService(deps);

    await service.searchSlots({
      from: new Date("2026-07-30T00:00:00.000Z"),
      to: new Date("2026-08-06T00:00:00.000Z"),
      now: new Date("1970-01-01T00:00:00.000Z"),
    });
    await service.reserve({
      ...deps.reserveCommand,
      now: new Date("1970-01-01T00:00:00.000Z"),
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date("2026-07-28T10:01:00.000Z"),
      }),
    );
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        now: new Date("2026-07-28T10:01:00.000Z"),
      }),
    );
  });
});
