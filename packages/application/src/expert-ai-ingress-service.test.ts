import { describe, expect, it, vi } from "vitest";

import { createExpertAiIngressService } from "./expert-ai-ingress-service.js";

const principal = {
  authenticated: true,
  userId: "00000000-0000-4000-8000-000000000001",
  expertId: "00000000-0000-4000-8000-000000000002",
};
const tariffVersionId = "00000000-0000-4000-8000-000000000003";
const code = "EXR_abcdefghijklmnopqrstuv";

const dependencies = (proposal: unknown, enabled = true) => {
  const referrals = {
    redeemCode: vi.fn(async () => ({
      kind: "redeemed" as const,
      referralId: "r1",
    })),
    summary: vi.fn(async () => ({
      availableMinor: "100000",
      reservedMinor: "0",
      debtMinor: "0",
      nearestExpiry: null,
    })),
  };
  const residency = {
    listActiveTariffs: vi.fn(async () => []),
    quote: vi.fn(async () => ({
      tariffVersionId,
      priceMinor: "200000",
      creditMinor: "100000",
      cashMinor: "100000",
      currency: "RUB" as const,
      durationSeconds: 31_536_000,
      displayName: "Год",
    })),
    checkout: vi.fn(async () => ({
      id: "order-1",
      status: "payment_pending" as const,
    })),
    reconciliation: {} as never,
  };
  const source = { propose: vi.fn(async () => proposal) };
  return {
    deps: { enabled, referrals, residency, source },
    referrals,
    residency,
    source,
  };
};

const command = {
  principal,
  text: "Помоги с резидентством",
  locale: "ru-RU",
  correlationId: "corr-er-ai-001",
  idempotencyKey: "telegram:42:expert-ai",
  tariffVersionId,
};

describe("expert AI ingress", () => {
  it("is fail-closed and calls nothing while disabled", async () => {
    const state = dependencies({ kind: "view_referral_summary" }, false);
    await expect(
      createExpertAiIngressService(state.deps).handle(command),
    ).resolves.toEqual({ kind: "disabled" });
    expect(state.source.propose).not.toHaveBeenCalled();
    expect(state.referrals.summary).not.toHaveBeenCalled();
    expect(state.referrals.redeemCode).not.toHaveBeenCalled();
    expect(state.residency.quote).not.toHaveBeenCalled();
    expect(state.residency.checkout).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "redeem_expert_referral", code }, "redeemCode"],
    [{ kind: "view_referral_summary" }, "summary"],
    [{ kind: "quote_residency", tariffVersionId }, "quote"],
    [{ kind: "start_residency_checkout", tariffVersionId }, "checkout"],
  ] as const)(
    "reauthorizes strict proposal %# through exactly one service operation",
    async (proposal, operation) => {
      const state = dependencies(proposal);
      await expect(
        createExpertAiIngressService(state.deps).handle(command),
      ).resolves.toMatchObject({
        kind: "completed",
        proposalKind: proposal.kind,
      });
      expect(state.source.propose).toHaveBeenCalledTimes(1);
      const calls = {
        redeemCode: state.referrals.redeemCode.mock.calls.length,
        summary: state.referrals.summary.mock.calls.length,
        quote: state.residency.quote.mock.calls.length,
        checkout: state.residency.checkout.mock.calls.length,
      };
      // Prompt context reads summary and the optional quote before proposal dispatch.
      expect(calls[operation]).toBe(
        operation === "summary" || operation === "quote" ? 2 : 1,
      );
      if (operation === "redeemCode") {
        expect(state.referrals.redeemCode).toHaveBeenCalledWith(
          principal,
          code,
          command.idempotencyKey,
        );
      } else {
        expect(state.referrals.redeemCode).not.toHaveBeenCalled();
      }
      if (operation === "checkout")
        expect(state.residency.checkout).toHaveBeenCalledWith(
          principal,
          tariffVersionId,
          command.idempotencyKey,
        );
    },
  );

  it.each([
    { kind: "set_referral_balance", balanceMinor: "999999" },
    { kind: "quote_residency", tariffVersionId, priceMinor: "1" },
    { kind: "start_residency_checkout", tariffVersionId, providerPayload: {} },
  ])("rejects hostile proposal without a mutation %#", async (proposal) => {
    const state = dependencies(proposal);
    await expect(
      createExpertAiIngressService(state.deps).handle(command),
    ).resolves.toEqual({ kind: "rejected", reasonCode: "unsupported_intent" });
    expect(state.referrals.redeemCode).not.toHaveBeenCalled();
    expect(state.residency.checkout).not.toHaveBeenCalled();
  });

  it.each([
    {
      kind: "quote_residency",
      tariffVersionId: "00000000-0000-4000-8000-000000000099",
    },
    {
      kind: "start_residency_checkout",
      tariffVersionId: "00000000-0000-4000-8000-000000000099",
    },
  ])(
    "rejects a syntactically valid tariff substitution %#",
    async (proposal) => {
      const state = dependencies(proposal);
      await expect(
        createExpertAiIngressService(state.deps).handle(command),
      ).resolves.toEqual({
        kind: "rejected",
        reasonCode: "unauthorized_scope",
      });
      expect(state.residency.checkout).not.toHaveBeenCalled();
      expect(state.residency.quote).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a financial proposal when no authoritative tariff context was requested", async () => {
    const state = dependencies({
      kind: "start_residency_checkout",
      tariffVersionId,
    });
    const withoutTariff = {
      principal: command.principal,
      text: command.text,
      locale: command.locale,
      correlationId: command.correlationId,
      idempotencyKey: command.idempotencyKey,
    };
    await expect(
      createExpertAiIngressService(state.deps).handle(withoutTariff),
    ).resolves.toEqual({ kind: "rejected", reasonCode: "unauthorized_scope" });
    expect(state.residency.quote).not.toHaveBeenCalled();
    expect(state.residency.checkout).not.toHaveBeenCalled();
  });
});
