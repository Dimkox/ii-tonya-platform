import { describe, expect, it, vi } from "vitest";
import { createExpertResidencyCheckoutCapability } from "./expert-residency-checkout.js";
import type {
  ResidencyCheckoutCallbackClaims,
  ResidencyCheckoutStateStore,
} from "./residency-checkout-callback-token.js";

const principal = {
  userId: "00000000-0000-4000-8000-000000000100",
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  timezone: "Europe/Moscow",
};
const tariffVersionId = "00000000-0000-4000-8000-000000000301";
const now = new Date("2026-08-14T10:00:00.000Z");

const build = () => {
  let stored:
    | { tokenHash: string; claims: ResidencyCheckoutCallbackClaims }
    | undefined;
  let outcome:
    | { kind: "ready"; checkoutUrl: string }
    | { kind: "unavailable" | "unknown" }
    | undefined;
  let claimed = false;
  const put = vi.fn<ResidencyCheckoutStateStore["put"]>(
    async (tokenHash, claims) => {
      stored = { tokenHash, claims };
    },
  );
  const store: ResidencyCheckoutStateStore = {
    put,
    consume: async () => null,
    inspectCheckout: vi.fn(async (tokenHash, expertId, telegramUserId) =>
      stored?.tokenHash === tokenHash &&
      stored.claims.expertId === expertId &&
      stored.claims.telegramUserId === telegramUserId
        ? stored.claims
        : null,
    ),
    claimCheckout: vi.fn(async (tokenHash, claims, _at, _lease, fence) => {
      if (outcome !== undefined) {
        return { kind: "replay" as const, tokenHash, outcome };
      }
      if (claimed) return { kind: "processing" as const, tokenHash };
      claimed = true;
      return {
        kind: "acquired" as const,
        tokenHash,
        claims: { ...claims, expiresAt: stored!.claims.expiresAt },
        fence,
        recovery: false,
      };
    }),
    recordCheckoutOutcome: vi.fn(async (_tokenHash, _fence, value) => {
      outcome = value;
      return true;
    }),
  };
  const checkout = vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000401",
    status: "payment_pending" as const,
    payment: {
      kind: "created" as const,
      paymentId: "provider-secret-id",
      checkoutUrl: "https://pay.example/checkout",
    },
  }));
  const capability = createExpertResidencyCheckoutCapability({
    secret: Buffer.alloc(32, 7),
    store,
    residency: { checkout },
    now: () => now,
    newFence: () => "00000000-0000-4000-8000-000000000501",
  });
  return { capability, checkout, store };
};

describe("expert Telegram residency checkout capability", () => {
  it("calls only authoritative checkout arguments and stores a bounded URL", async () => {
    const state = build();
    const token = await state.capability.issue({
      principal,
      tariffVersionId,
      idempotencyKey: "telegram:quote:1:checkout",
    });

    const result = await state.capability.process({ data: token, principal });

    expect(state.checkout).toHaveBeenCalledWith(
      {
        authenticated: true,
        userId: principal.userId,
        expertId: principal.expertId,
      },
      tariffVersionId,
      expect.stringMatching(/^[0-9a-f]{64}$/u),
    );
    expect(result).toMatchObject({
      kind: "ready",
      checkoutUrl: "https://pay.example/checkout",
      replay: false,
    });
    expect(JSON.stringify(result)).not.toContain("provider-secret-id");
  });

  it("returns a stored terminal replay without calling checkout again", async () => {
    const state = build();
    const token = await state.capability.issue({
      principal,
      tariffVersionId,
      idempotencyKey: "telegram:quote:2:checkout",
    });
    const first = await state.capability.process({ data: token, principal });
    const replay = await state.capability.process({ data: token, principal });

    expect(first.kind).toBe("ready");
    expect(replay).toMatchObject({ kind: "ready", replay: true });
    expect(state.checkout).toHaveBeenCalledTimes(1);
  });

  it("records an unknown mutation outcome without retrying it immediately", async () => {
    const state = build();
    state.checkout.mockRejectedValueOnce(new Error("provider details"));
    const token = await state.capability.issue({
      principal,
      tariffVersionId,
      idempotencyKey: "telegram:quote:3:checkout",
    });

    await expect(
      state.capability.process({ data: token, principal }),
    ).resolves.toMatchObject({ kind: "unknown", replay: false });
    await expect(
      state.capability.process({ data: token, principal }),
    ).resolves.toMatchObject({ kind: "unknown", replay: true });
    expect(state.checkout).toHaveBeenCalledTimes(1);
  });
});
