import { describe, expect, it } from "vitest";
import {
  authenticateResidencyCheckoutCallback,
  issueResidencyCheckoutCallback,
} from "./residency-checkout-callback-token.js";

const claims = {
  expertId: "00000000-0000-4000-8000-000000000101",
  telegramUserId: "123456789",
  tariffVersionId: "00000000-0000-4000-8000-000000000301",
  action: "start_residency_checkout" as const,
  expiresAt: new Date("2026-08-14T05:00:00.000Z"),
};

describe("xr1 residency checkout callback", () => {
  it("reissues the exact token for one server idempotency key", async () => {
    const stored = new Map<string, typeof claims>();
    const store = {
      put: async (hash: string, value: typeof claims) => {
        stored.set(hash, stored.get(hash) ?? value);
      },
      consume: async () => null,
    };
    const secret = new Uint8Array(32).fill(7);

    const first = await issueResidencyCheckoutCallback(
      claims,
      "quote-retry-1",
      secret,
      store,
    );
    const retry = await issueResidencyCheckoutCallback(
      { ...claims, expiresAt: new Date("2026-08-14T05:01:00.000Z") },
      "quote-retry-1",
      secret,
      store,
    );

    expect(retry).toBe(first);
    expect(stored).toHaveLength(1);
  });

  it("issues an isolated token and consumes it once with fresh identity binding", async () => {
    let storedHash = "";
    let consumed = false;
    const store = {
      put: async (hash: string) => {
        storedHash = hash;
      },
      consume: async (
        hash: string,
        binding: Omit<typeof claims, "expiresAt">,
      ) => {
        if (
          consumed ||
          hash !== storedHash ||
          binding.expertId !== claims.expertId ||
          binding.telegramUserId !== claims.telegramUserId
        )
          return null;
        consumed = true;
        return claims;
      },
    };
    const secret = new Uint8Array(32).fill(7);
    const token = await issueResidencyCheckoutCallback(
      claims,
      "quote-1",
      secret,
      store,
    );
    expect(token).toMatch(/^xr1\./u);
    expect(token).not.toMatch(/^(?:ct2|cv1)\./u);
    await expect(
      authenticateResidencyCheckoutCallback(
        token,
        claims,
        secret,
        store,
        new Date("2026-08-14T04:59:00.000Z"),
      ),
    ).resolves.toMatchObject({ claims });
    await expect(
      authenticateResidencyCheckoutCallback(
        token,
        claims,
        secret,
        store,
        new Date("2026-08-14T04:59:00.000Z"),
      ),
    ).rejects.toThrow("Residency checkout callback verification failed");
  });
});
