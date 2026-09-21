import { describe, expect, it } from "vitest";
import { buildExpertView, type ReservationViewInput } from "./consent.js";

describe("privacy minimization", () => {
  it("shows the expert appointment data and only the consented note", () => {
    expect(
      buildExpertView({
        reservationId: "r-1",
        startsAt: "2026-08-01T09:00:00.000Z",
        displayTimezone: "Europe/Moscow",
        clientDisplayName: "Аня",
        expertNote: "предпочитает утро",
        expertNoteConsent: false,
        expertHandoffConsent: true,
      }),
    ).not.toHaveProperty("expertNote");
  });

  it("collapses to the minimal handoff when expert_handoff is withheld, even with a consented note", () => {
    expect(
      buildExpertView({
        reservationId: "r-1",
        startsAt: "2026-08-01T09:00:00.000Z",
        displayTimezone: "Europe/Moscow",
        clientDisplayName: "Аня",
        expertNote: "предпочитает утро",
        expertNoteConsent: true,
        expertHandoffConsent: false,
      }),
    ).toEqual({
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Клиент",
    });
  });

  it("shows the name and consented note once expert_handoff is granted", () => {
    expect(
      buildExpertView({
        reservationId: "r-1",
        startsAt: "2026-08-01T09:00:00.000Z",
        displayTimezone: "Europe/Moscow",
        clientDisplayName: "Аня",
        expertNote: "предпочитает утро",
        expertNoteConsent: true,
        expertHandoffConsent: true,
      }),
    ).toEqual({
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Аня",
      expertNote: "предпочитает утро",
    });
  });

  it("fails closed when expert_handoff consent is absent at runtime", () => {
    // The field is required; this simulates a caller that forgot to wire the lateral.
    const partial = {
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Аня",
      expertNote: "предпочитает утро",
      expertNoteConsent: true,
    } as unknown as ReservationViewInput;
    expect(buildExpertView(partial)).toEqual({
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Клиент",
    });
  });
});
