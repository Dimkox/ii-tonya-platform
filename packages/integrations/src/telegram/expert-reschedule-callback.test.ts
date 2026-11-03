import {
  encodeExpertReschedulePick,
  encodeExpertRescheduleStart,
  parseExpertRescheduleCallback,
} from "@ii-tonya/contracts";
import { describe, expect, it, vi } from "vitest";

import { createExpertCommandProcessor } from "./expert-command-processor.js";

const principal = {
  userId: "00000000-0000-4000-8000-000000000100",
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  timezone: "Europe/Moscow",
};
const reservationId = "00000000-0000-4000-8000-000000000201";
const slotId = "00000000-0000-4000-8000-000000000301";

const build = (
  result:
    | { kind: "rescheduled"; reservationId: string; reservedUntil: Date }
    | { kind: "forbidden" | "conflict" },
) => {
  const listSlots = vi.fn(async () => [
    { slotId, startsAt: new Date("2026-11-10T09:00:00.000Z") },
  ]);
  const reschedule = vi.fn(async () => result);
  const sendRescheduleChoices = vi.fn(async () => ({ kind: "sent" as const }));
  const sendRescheduleResult = vi.fn(async () => ({ kind: "sent" as const }));
  const processor = createExpertCommandProcessor({
    enabled: true,
    queries: {} as never,
    views: { sendRescheduleChoices, sendRescheduleResult } as never,
    reschedule: { listSlots, reschedule },
  });
  return {
    processor,
    listSlots,
    reschedule,
    sendRescheduleChoices,
    sendRescheduleResult,
  };
};

describe("SCRUM-64 🔄 expert reschedule callbacks", () => {
  it("round-trips rs1/rs2 and rejects garbage", () => {
    const start = encodeExpertRescheduleStart(reservationId);
    expect(start).toMatch(/^rs1\.[A-Za-z0-9_-]{22}$/u);
    expect(parseExpertRescheduleCallback(start)).toEqual({
      kind: "start",
      reservationId,
    });
    const pick = encodeExpertReschedulePick(reservationId, slotId);
    expect(pick.length).toBeLessThanOrEqual(64);
    expect(parseExpertRescheduleCallback(pick)).toEqual({
      kind: "pick",
      reservationId,
      slotId,
    });
    expect(parseExpertRescheduleCallback("rs1.x")).toBeNull();
    expect(parseExpertRescheduleCallback("ct2.abc")).toBeNull();
  });

  it("offers free slots scoped to the principal expert", async () => {
    const state = build({ kind: "conflict" });
    await expect(
      state.processor.processReschedule({
        data: encodeExpertRescheduleStart(reservationId),
        principal,
        idempotencyKey: "telegram:1:reschedule",
        correlationId: "c1",
      }),
    ).resolves.toMatchObject({ kind: "processed" });
    expect(state.listSlots).toHaveBeenCalledWith({
      expertId: principal.expertId,
      reservationId,
      limit: 5,
    });
    expect(state.sendRescheduleChoices).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          {
            startsAt: "2026-11-10T09:00:00.000Z",
            callbackData: encodeExpertReschedulePick(reservationId, slotId),
          },
        ],
      }),
    );
  });

  it("reports the new 72h hold after a successful pick", async () => {
    const reservedUntil = new Date("2026-11-06T09:00:00.000Z");
    const state = build({
      kind: "rescheduled",
      reservationId: "00000000-0000-4000-8000-000000000202",
      reservedUntil,
    });
    await state.processor.processReschedule({
      data: encodeExpertReschedulePick(reservationId, slotId),
      principal,
      idempotencyKey: "telegram:2:reschedule",
      correlationId: "c2",
    });
    expect(state.reschedule).toHaveBeenCalledWith({
      expertId: principal.expertId,
      reservationId,
      targetSlotId: slotId,
      idempotencyKey: "telegram:2:reschedule",
      correlationId: "c2",
    });
    expect(state.sendRescheduleResult).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "rescheduled",
        reservedUntil: reservedUntil.toISOString(),
      }),
    );
  });

  it("returns forbidden for a foreign booking without sending anything", async () => {
    const state = build({ kind: "forbidden" });
    await expect(
      state.processor.processReschedule({
        data: encodeExpertReschedulePick(reservationId, slotId),
        principal,
        idempotencyKey: "telegram:3:reschedule",
        correlationId: "c3",
      }),
    ).resolves.toEqual({ kind: "forbidden" });
    expect(state.sendRescheduleResult).not.toHaveBeenCalled();
  });
});
