import { describe, expect, it, vi } from "vitest";

import type {
  ExpertPrincipal,
  ExpertReferralService,
  ExpertResidencyService,
} from "@ii-tonya/application";
import { buildExpertReferralApi } from "./expert-referral.js";

const principal: ExpertPrincipal = {
  authenticated: true,
  userId: "00000000-0000-4000-8000-000000000001",
  expertId: "00000000-0000-4000-8000-000000000002",
};
const tariffVersionId = "00000000-0000-4000-8000-000000000101";
const code = `EXR_${"A".repeat(22)}`;
const authorization = "Bearer opaque-session-token";

const build = async (options: {
  resolve?: (authorization: string | undefined) => Promise<ExpertPrincipal | null>;
  redeem?: ExpertReferralService["redeemCode"];
  summary?: ExpertReferralService["summary"];
  listActiveTariffs?: ExpertResidencyService["listActiveTariffs"];
  quote?: ExpertResidencyService["quote"];
  checkout?: ExpertResidencyService["checkout"];
} = {}) => {
  const redeemCode = vi.fn(
    options.redeem ??
      (async () => ({ kind: "redeemed" as const, referralId: "ref-1" })),
  );
  const summary = vi.fn(
    options.summary ??
      (async () => ({
        availableMinor: "100000",
        reservedMinor: "0",
        debtMinor: "0",
        nearestExpiry: null,
      })),
  );
  const quote = vi.fn(
    options.quote ??
      (async () => ({
        tariffVersionId,
        priceMinor: "200000",
        creditMinor: "100000",
        cashMinor: "100000",
        commercialPolicyVersion: "expert_residency_v2" as const,
        creditCapBps: 3000,
        individualServicesEnabled: true,
        groupEventLimit: 0,
        statisticsLevel: "basic" as const,
        supportPriority: "standard" as const,
      })),
  );
  const listActiveTariffs = vi.fn(
    options.listActiveTariffs ??
      (async () => [
        {
          tariffVersionId,
          displayName: "Резидентство на месяц",
          priceMinor: "200000",
          currency: "RUB" as const,
          durationSeconds: 2_592_000,
          supportPriority: "standard" as const,
          commercialPolicyVersion: "expert_residency_v2" as const,
          creditCapBps: 3000,
          individualServicesEnabled: true,
          groupEventLimit: 0,
          statisticsLevel: "basic" as const,
        },
      ]),
  );
  const checkout = vi.fn(
    options.checkout ??
      (async () => ({
        id: "00000000-0000-4000-8000-000000000201",
        status: "payment_pending" as const,
        commercialPolicyVersion: "expert_residency_v2" as const,
        creditCapBps: 3000,
        individualServicesEnabled: true,
        groupEventLimit: 0,
        statisticsLevel: "basic" as const,
        supportPriority: "standard" as const,
      })),
  );
  const app = await buildExpertReferralApi({
    principals: {
      resolve:
        options.resolve ??
        (async (value) => (value === authorization ? principal : null)),
    },
    referrals: { redeemCode, summary },
    residency: {
      listActiveTariffs,
      quote,
      checkout,
      reconciliation: {
        settle: vi.fn(),
        reverse: vi.fn(),
        replayHeldReward: vi.fn(),
        releaseExpiredOrders: vi.fn(),
      },
    },
  });
  return {
    app,
    redeemCode,
    summary,
    listActiveTariffs,
    quote,
    checkout,
  };
};

describe("expert referral API", () => {
  it("returns only the freshly authenticated expert's active tariff projection", async () => {
    const { app, listActiveTariffs } = await build();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/expert/residency/tariffs",
        headers: { authorization },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          tariffVersionId,
          displayName: "Резидентство на месяц",
          priceMinor: "200000",
          currency: "RUB",
          durationSeconds: 2_592_000,
          commercialPolicyVersion: "expert_residency_v2",
          creditCapBps: 3000,
          individualServicesEnabled: true,
          groupEventLimit: 0,
          statisticsLevel: "basic",
          supportPriority: "standard",
        },
      ]);
      expect(listActiveTariffs).toHaveBeenCalledWith(principal);
    } finally {
      await app.close();
    }
  });

  it("does not query tariffs without a fresh authenticated principal", async () => {
    const { app, listActiveTariffs } = await build();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/expert/residency/tariffs",
      });

      expect(response.statusCode).toBe(401);
      expect(listActiveTariffs).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    [{ kind: "forbidden" as const }, 403],
    [{ kind: "disabled" as const }, 503],
  ])("maps a bounded tariff discovery result %#", async (result, status) => {
    const { app } = await build({
      listActiveTariffs: async () => result,
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/expert/residency/tariffs",
        headers: { authorization },
      });
      expect(response.statusCode).toBe(status);
    } finally {
      await app.close();
    }
  });

  it("reauthorizes the principal and fails closed on cross-expert ownership", async () => {
    const { app, redeemCode } = await build({
      redeem: async () => ({ kind: "forbidden" }),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/expert/referrals/redeem",
        headers: { authorization },
        payload: { code, idempotencyKey: "redeem-0001" },
      });
      expect(response.statusCode).toBe(403);
      expect(redeemCode).toHaveBeenCalledWith(
        principal,
        code,
        "redeem-0001",
      );
    } finally {
      await app.close();
    }
  });

  it("rejects client-supplied financial authority before quote service execution", async () => {
    const { app, quote } = await build();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/expert/residency/quotes",
        headers: { authorization },
        payload: {
          tariffVersionId,
          priceMinor: "1",
          creditMinor: "1",
        },
      });
      expect(response.statusCode).toBe(400);
      expect(quote).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("accepts only a server-issued tariff id and idempotency key for checkout", async () => {
    const { app, checkout } = await build();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/expert/residency/checkouts",
        headers: { authorization },
        payload: {
          tariffVersionId,
          idempotencyKey: "checkout-0001",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(checkout).toHaveBeenCalledWith(
        principal,
        tariffVersionId,
        "checkout-0001",
      );
    } finally {
      await app.close();
    }
  });

  it("does not trust expert identity fields from the request body", async () => {
    const { app, redeemCode } = await build();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/expert/referrals/redeem",
        headers: { authorization },
        payload: {
          code,
          idempotencyKey: "redeem-0002",
          expertId: "00000000-0000-4000-8000-000000000999",
        },
      });
      expect(response.statusCode).toBe(400);
      expect(redeemCode).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("requires an authenticated principal for expert queries", async () => {
    const { app, summary } = await build();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/expert/referrals/summary",
      });
      expect(response.statusCode).toBe(401);
      expect(summary).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
