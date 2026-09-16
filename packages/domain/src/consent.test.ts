import { describe, expect, it } from "vitest";
import { buildExpertView, buildProfilePatch } from "./consent.js";

describe("privacy minimization", () => {
  it("drops optional profile data without a current explicit grant", () => {
    expect(
      buildProfilePatch(
        {
          displayName: "Аня",
          goals: "снизить тревогу",
          expertNote: "предпочитает утро",
        },
        [],
      ),
    ).toEqual({ displayName: "Аня" });
  });

  it("shows the expert appointment data and only the consented note", () => {
    expect(
      buildExpertView({
        reservationId: "r-1",
        startsAt: "2026-08-01T09:00:00.000Z",
        displayTimezone: "Europe/Moscow",
        clientDisplayName: "Аня",
        expertNote: "предпочитает утро",
        expertNoteConsent: false,
      }),
    ).not.toHaveProperty("expertNote");
  });

  it("fails closed for invalid consent timestamps and equal-time conflicts", () => {
    const input = { displayName: "Аня", goals: "снизить тревогу" };
    expect(
      buildProfilePatch(input, [
        {
          purpose: "client_profile",
          granted: true,
          recordedAt: new Date("invalid"),
        },
        {
          purpose: "client_profile",
          granted: false,
          recordedAt: new Date("2026-07-28T10:00:00.000Z"),
        },
      ]),
    ).toEqual({ displayName: "Аня" });

    const validGrantedAt = new Date("2026-07-28T10:00:00.000Z");
    const invalidDeniedAt = new Date("invalid");
    for (const grants of [
      [
        {
          purpose: "client_profile" as const,
          granted: true,
          recordedAt: validGrantedAt,
        },
        {
          purpose: "client_profile" as const,
          granted: false,
          recordedAt: invalidDeniedAt,
        },
      ],
      [
        {
          purpose: "client_profile" as const,
          granted: false,
          recordedAt: invalidDeniedAt,
        },
        {
          purpose: "client_profile" as const,
          granted: true,
          recordedAt: validGrantedAt,
        },
      ],
      [
        {
          purpose: "client_profile" as const,
          granted: true,
          recordedAt: validGrantedAt,
        },
        {
          purpose: "client_profile" as const,
          granted: true,
          recordedAt: invalidDeniedAt,
        },
      ],
    ]) {
      expect(buildProfilePatch(input, grants)).toEqual({ displayName: "Аня" });
    }

    const recordedAt = new Date("2026-07-28T10:00:00.000Z");
    for (const grants of [
      [
        { purpose: "client_profile" as const, granted: true, recordedAt },
        { purpose: "client_profile" as const, granted: false, recordedAt },
      ],
      [
        { purpose: "client_profile" as const, granted: false, recordedAt },
        { purpose: "client_profile" as const, granted: true, recordedAt },
      ],
    ]) {
      expect(buildProfilePatch(input, grants)).toEqual({ displayName: "Аня" });
    }
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

  it("keeps legacy behavior for callers that have not wired expert_handoff", () => {
    expect(
      buildExpertView({
        reservationId: "r-1",
        startsAt: "2026-08-01T09:00:00.000Z",
        displayTimezone: "Europe/Moscow",
        clientDisplayName: "Аня",
        expertNote: "предпочитает утро",
        expertNoteConsent: true,
      }),
    ).toEqual({
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Аня",
      expertNote: "предпочитает утро",
    });
  });
});
