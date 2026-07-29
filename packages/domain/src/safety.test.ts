import { describe, expect, it, vi } from "vitest";
import { evaluateSafety, transitionHandoff } from "./safety.js";

describe("safety evaluation", () => {
  const now = new Date("2026-07-28T10:00:00.000Z");
  const freshContact = {
    id: "contact-1",
    label: "Verified crisis contact",
    channel: "__PLACEHOLDER_VERIFIED_CONTACT_CHANNEL__",
    countryCode: "RU",
    regionCode: "MOW",
    ageBands: ["adult"] as const,
    riskTypes: ["self_harm", "uncertain"] as const,
    sourceUrl: "https://contacts.invalid/evidence/contact-1",
    owner: "clinical-safety-owner",
    verifiedAt: new Date("2026-07-01T00:00:00.000Z"),
    validUntil: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("SAFE-01 runs deterministic high-risk guards before a model that says ordinary", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("ordinary" as const) };
    const guard = { detect: vi.fn().mockReturnValue("self_harm" as const) };
    const decision = await evaluateSafety({
      text: "guard fixture",
      countryCode: "RU",
      regionCode: "MOW",
      ageBand: "adult",
      ledgerBalance: 0,
      now,
    }, guard, classifier, { list: () => [freshContact] });
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ kind: "human_handoff", reason: "self_harm", charge: 0 });
  });

  it("SAFE-02 returns a free handoff with a fresh scoped contact at zero balance", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("self_harm" as const) };
    const guard = { detect: vi.fn().mockReturnValue(null) };
    const decision = await evaluateSafety(
      {
        text: "classifier fixture",
        countryCode: "RU",
        regionCode: "MOW",
        ageBand: "adult",
        ledgerBalance: 0,
        now,
      },
      guard,
      classifier,
      { list: () => [freshContact] },
    );
    expect(decision).toMatchObject({ kind: "human_handoff", charge: 0 });
    expect(decision.contacts).toHaveLength(1);
  });

  it("SAFE-03 rejects stale or wrong-scope contacts", async () => {
    const guard = { detect: vi.fn().mockReturnValue("self_harm" as const) };
    const stale = { ...freshContact, validUntil: new Date("2026-07-27T00:00:00.000Z") };
    const decision = await evaluateSafety({
      text: "guard fixture",
      countryCode: "RU",
      regionCode: "MOW",
      ageBand: "adult",
      ledgerBalance: 0,
      now,
    }, guard, { classify: vi.fn() }, { list: () => [stale] });
    expect(decision).toMatchObject({
      kind: "human_handoff",
      reason: "self_harm",
      directoryState: "no_fresh_contact",
      contacts: [],
    });
  });

  it("SAFE-04 uses a conservative free handoff when the classifier is unavailable", async () => {
    const classifier = { classify: vi.fn().mockRejectedValue(new Error("offline")) };
    const guard = { detect: vi.fn().mockReturnValue(null) };
    await expect(evaluateSafety(
      {
        text: "uncertain fixture",
        countryCode: "RU",
        regionCode: "MOW",
        ageBand: "adult",
        ledgerBalance: 5,
        now,
      },
      guard,
      classifier,
      { list: () => [freshContact] },
    )).resolves.toMatchObject({
      kind: "human_handoff",
      charge: 0,
      reason: "classifier_unavailable",
      directoryState: "fresh_fallback",
      contacts: [expect.objectContaining({ id: "contact-1" })],
    });
  });

  it("fails closed when the deterministic guard throws before classifier use", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("ordinary" as const) };
    const guard = { detect: vi.fn().mockImplementation(() => { throw new Error("guard unavailable"); }) };
    await expect(evaluateSafety({
      text: "guard failure fixture",
      countryCode: "RU",
      regionCode: "MOW",
      ageBand: "adult",
      ledgerBalance: 5,
      now,
    }, guard, classifier, { list: () => [freshContact] })).resolves.toMatchObject({
      kind: "human_handoff",
      charge: 0,
      reason: "classifier_unavailable",
      directoryState: "fresh_fallback",
      contacts: [expect.objectContaining({ id: "contact-1" })],
    });
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it("normalizes country and region codes while preserving null regions", async () => {
    const classifier = { classify: vi.fn().mockResolvedValue("self_harm" as const) };
    const guard = { detect: vi.fn().mockReturnValue(null) };
    const regional = { ...freshContact, countryCode: " ru ", regionCode: " mow " };
    const national = { ...freshContact, id: "contact-2", countryCode: " ru ", regionCode: null };

    await expect(evaluateSafety({
      text: "normalized regional fixture",
      countryCode: " RU ",
      regionCode: " mow ",
      ageBand: "adult",
      ledgerBalance: 0,
      now,
    }, guard, classifier, { list: () => [regional] })).resolves.toMatchObject({
      kind: "human_handoff",
      contacts: [expect.objectContaining({ id: "contact-1" })],
    });

    await expect(evaluateSafety({
      text: "normalized national fixture",
      countryCode: " ru ",
      regionCode: null,
      ageBand: "adult",
      ledgerBalance: 0,
      now,
    }, guard, classifier, { list: () => [national] })).resolves.toMatchObject({
      kind: "human_handoff",
      contacts: [expect.objectContaining({ id: "contact-2" })],
    });
  });

  it("SAFE-05 assigns an opened handoff and escalates at the inclusive SLA deadline", () => {
    const assigned = transitionHandoff({
      status: "opened",
      ownerId: null,
      openedAt: new Date("2026-07-28T09:00:00.000Z"),
      acknowledgeBy: new Date("2026-07-28T10:00:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      version: 1,
    }, { kind: "assign", ownerId: "operator-1" }, new Date("2026-07-28T09:01:00.000Z"));
    expect(assigned).toMatchObject({
      status: "assigned",
      ownerId: "operator-1",
      version: 2,
    });
    expect(transitionHandoff(
      assigned,
      { kind: "check_ack_sla" },
      new Date("2026-07-28T10:00:00.000Z"),
    )).toMatchObject({ status: "escalated", version: 3 });
  });
});
