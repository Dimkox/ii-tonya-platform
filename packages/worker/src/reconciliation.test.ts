import { describe, expect, it } from "vitest";
import { reconcileProviderReservations } from "./reconciliation.js";
import { reconciliationFixture } from "./worker-jobs.testkit.js";

describe("provider reconciliation", () => {
  it("reports drift, repairs only safe projection drift, and never guesses provider state", async () => {
    const deps = reconciliationFixture({
      local: [{ id: "r-1", externalId: "p-1", status: "reserved" }],
      provider: [{ externalId: "p-1", status: "booked" }],
    });
    const report = await reconcileProviderReservations(deps, {
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-07-29T00:00:00.000Z",
    });

    expect(report.mismatches).toEqual([
      { reservationId: "r-1", local: "reserved", provider: "booked" },
    ]);
    expect(deps.transitions).toHaveLength(0);
    expect(deps.alerts).toEqual(["reservation_state_drift"]);
  });

  it("reports provider unavailability, opens the circuit at its threshold, and leaves local state unchanged", async () => {
    const deps = reconciliationFixture({
      local: [{ id: "r-1", externalId: "p-1", status: "reserved" }],
      provider: [{ externalId: "p-1", status: "reserved" }],
      providerUnavailable: true,
      circuitFailureThreshold: 2,
    });
    const window = {
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-07-29T00:00:00.000Z",
    } as const;

    const first = await reconcileProviderReservations(deps, window);
    const second = await reconcileProviderReservations(deps, window);

    expect(first.provider).toBe("provider_unavailable");
    expect(second.provider).toBe("provider_unavailable");
    expect(deps.circuit.isOpen()).toBe(true);
    expect(deps.transitions).toHaveLength(0);
    expect(deps.alerts).toEqual([
      "provider_unavailable",
      "provider_unavailable",
    ]);
  });

  it("fails the provider snapshot closed when a local reservation is omitted", async () => {
    const deps = reconciliationFixture({
      local: [{ id: "r-1", externalId: "p-1", status: "reserved" }],
      provider: [],
    });

    const report = await reconcileProviderReservations(deps, {
      from: "2026-07-28T00:00:00.000Z",
      to: "2026-07-29T00:00:00.000Z",
    });

    expect(report.provider).toBe("provider_unavailable");
    expect(report.mismatches).toEqual([]);
    expect(deps.alerts).toEqual(["provider_unavailable"]);
    expect(deps.transitions).toHaveLength(0);
  });
});
