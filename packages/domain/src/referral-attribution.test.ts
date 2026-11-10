import { describe, expect, it } from "vitest";
import { decideFirstAttribution } from "./referral-attribution.js";

const referred = "referred";
const first = "first-inviter";
const second = "second-inviter";

describe("first inviter attribution", () => {
  it("attributes a new visitor to the first inviter", () => {
    expect(
      decideFirstAttribution({
        referredId: referred,
        requestedInviterId: first,
        existingInviterId: null,
        alreadyRegistered: false,
        priorStartWithoutCode: false,
      }),
    ).toEqual({ kind: "created", inviterId: first });
  });

  it("keeps the first inviter when another code is entered", () => {
    expect(
      decideFirstAttribution({
        referredId: referred,
        requestedInviterId: second,
        existingInviterId: first,
        alreadyRegistered: true,
        priorStartWithoutCode: false,
      }),
    ).toEqual({ kind: "kept", inviterId: first });
  });

  it("does not count a person who already started without a code", () => {
    expect(
      decideFirstAttribution({
        referredId: referred,
        requestedInviterId: first,
        existingInviterId: null,
        alreadyRegistered: false,
        priorStartWithoutCode: true,
      }),
    ).toEqual({ kind: "ignored_late_start" });
  });

  it("rejects self-referral", () => {
    expect(
      decideFirstAttribution({
        referredId: referred,
        requestedInviterId: referred,
        existingInviterId: null,
        alreadyRegistered: false,
        priorStartWithoutCode: false,
      }),
    ).toEqual({ kind: "self" });
  });

  it("keeps an unreferred registration idempotent", () => {
    expect(
      decideFirstAttribution({
        referredId: referred,
        requestedInviterId: null,
        existingInviterId: null,
        alreadyRegistered: true,
        priorStartWithoutCode: false,
      }),
    ).toEqual({ kind: "kept", inviterId: null });
  });
});
