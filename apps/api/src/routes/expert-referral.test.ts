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
      })),
  );
  const checkout = vi.fn(
    options.checkout ??
      (async () => ({
        id: "00000000-0000-4000-8000-000000000201",
        status: "payment_pending",
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
  return { app, redeemCode, summary, quote, checkout };
};

describe("expert referral API", () => {
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
