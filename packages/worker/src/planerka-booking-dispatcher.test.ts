import { expect, it, vi } from "vitest";
import {
  preflightPlanerkaBooking,
  type PlanerkaBookingDependencies,
} from "./planerka-booking-dispatcher.js";
function fixture() {
  return {
    accountId: 1,
    createEnabled: true,
    repository: {
      admitRequest: vi.fn(async () => true),
      mappings: vi.fn(async () => [
        { eventTypeId: 2, durationMinutes: 60, timeZone: "UTC" },
      ]),
    },
    client: {
      getProfile: vi.fn(async () => ({ id: 1, timeZone: "UTC" })),
      listEventTypes: vi.fn(async () => [
        {
          id: 2,
          ownerId: 1,
          length: 60,
          lengthInMinutes: 60,
          requiresConfirmation: false,
          hidden: false,
          price: 0,
        },
      ]),
    },
  };
}
it("checks account ownership and every event mapping before enabling creation", async () => {
  const f = fixture();
  await expect(
    preflightPlanerkaBooking(f as unknown as PlanerkaBookingDependencies),
  ).resolves.toBeUndefined();
  for (const patch of [
    { ownerId: 3 },
    { length: 30 },
    { requiresConfirmation: true },
    { hidden: true },
    { price: 5000 },
  ]) {
    const base = fixture();
    const event = (await base.client.listEventTypes())[0]!;
    base.client.listEventTypes.mockResolvedValue([{ ...event, ...patch }]);
    await expect(
      preflightPlanerkaBooking(base as unknown as PlanerkaBookingDependencies),
    ).rejects.toThrow("mapping_invalid");
  }
});
it("rejects empty mappings while recovery needs only matching account access", async () => {
  const f = fixture();
  f.repository.mappings.mockResolvedValue([]);
  await expect(
    preflightPlanerkaBooking(f as unknown as PlanerkaBookingDependencies),
  ).rejects.toThrow("mappings_unavailable");
  await expect(
    preflightPlanerkaBooking({
      ...f,
      createEnabled: false,
    } as unknown as PlanerkaBookingDependencies),
  ).resolves.toBeUndefined();
  f.client.getProfile.mockResolvedValue({ id: 9, timeZone: "UTC" });
  await expect(
    preflightPlanerkaBooking({
      ...f,
      createEnabled: false,
    } as unknown as PlanerkaBookingDependencies),
  ).rejects.toThrow("account_mismatch");
});
