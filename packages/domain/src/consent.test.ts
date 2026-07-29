import { describe, expect, it } from "vitest";
import { buildExpertView, buildProfilePatch } from "./consent.js";

describe("privacy minimization", () => {
  it("drops optional profile data without a current explicit grant", () => {
    expect(buildProfilePatch(
      { displayName: "Аня", goals: "снизить тревогу", expertNote: "предпочитает утро" },
      [],
    )).toEqual({ displayName: "Аня" });
  });

  it("shows the expert appointment data and only the consented note", () => {
    expect(buildExpertView({
      reservationId: "r-1",
      startsAt: "2026-08-01T09:00:00.000Z",
      displayTimezone: "Europe/Moscow",
      clientDisplayName: "Аня",
      expertNote: "предпочитает утро",
      expertNoteConsent: false,
    })).not.toHaveProperty("expertNote");
  });
});
