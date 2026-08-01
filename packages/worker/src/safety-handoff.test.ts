import { describe, expect, it } from "vitest";
import { processSafetyHandoffs } from "./safety-handoff.js";
import { safetyHandoffFixture } from "./worker-jobs.testkit.js";

describe("durable safety handoff", () => {
  it("assigns, acknowledges, and escalates overdue cases independently of provider outages", async () => {
    const deps = safetyHandoffFixture([
      {
        id: "handoff-overdue",
        status: "assigned",
        ownerId: "operator-1",
        acknowledgeBy: "2026-07-28T09:55:00.000Z",
        acknowledgedAt: null,
        version: 2,
      },
      {
        id: "handoff-acknowledged",
        status: "acknowledged",
        ownerId: "operator-2",
        acknowledgeBy: "2026-07-28T09:55:00.000Z",
        acknowledgedAt: "2026-07-28T09:54:00.000Z",
        version: 3,
      },
    ]);
    deps.planerkaCircuit.open();
    deps.intentModelCircuit.open();
    const result = await processSafetyHandoffs(
      deps,
      new Date("2026-07-28T10:00:00.000Z"),
      100,
    );

    expect(result).toEqual({ examined: 2, escalated: 1, unchanged: 1 });
    expect(deps.status("handoff-overdue")).toBe("escalated");
    expect(deps.outbox.topics()).toEqual(["safety.operator_escalation"]);
    expect(deps.audit.actions()).toEqual(["safety.handoff_sla_escalated"]);
  });

  it("bounds claims and does not duplicate an escalation effect", async () => {
    const deps = safetyHandoffFixture([
      {
        id: "handoff-1",
        status: "assigned",
        ownerId: "operator-1",
        acknowledgeBy: "2026-07-28T09:55:00.000Z",
        acknowledgedAt: null,
        version: 2,
      },
      {
        id: "handoff-2",
        status: "assigned",
        ownerId: "operator-2",
        acknowledgeBy: "2026-07-28T09:56:00.000Z",
        acknowledgedAt: null,
        version: 3,
      },
    ]);
    const now = new Date("2026-07-28T10:00:00.000Z");

    expect(await processSafetyHandoffs(deps, now, 1)).toEqual({
      examined: 1,
      escalated: 1,
      unchanged: 0,
    });
    expect(await processSafetyHandoffs(deps, now, 1)).toEqual({
      examined: 1,
      escalated: 1,
      unchanged: 0,
    });
    expect(await processSafetyHandoffs(deps, now, 1)).toEqual({
      examined: 0,
      escalated: 0,
      unchanged: 0,
    });
    expect(deps.outbox.topics()).toEqual([
      "safety.operator_escalation",
      "safety.operator_escalation",
    ]);
    expect(deps.outbox.allFree()).toBe(true);
  });

  it("rejects an effectively unbounded transaction batch", async () => {
    const deps = safetyHandoffFixture([]);

    await expect(processSafetyHandoffs(
      deps,
      new Date("2026-07-28T10:00:00.000Z"),
      1_001,
    )).rejects.toThrow("Invalid safety handoff batch input");
  });
});
