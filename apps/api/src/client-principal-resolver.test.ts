import { describe, expect, it, vi } from "vitest";

import { resolveClientPrincipal } from "./client-principal-resolver.js";

const userId = "00000000-0000-4000-8000-000000000101";

describe("client principal resolver boundary", () => {
  it("accepts only an exact active authenticated canonical principal", async () => {
    const resolver = {
      resolve: vi.fn(async () => ({
        authenticated: true as const,
        active: true as const,
        userId,
      })),
    };

    await expect(
      resolveClientPrincipal(resolver, `Bearer ${"A".repeat(32)}`),
    ).resolves.toEqual({ authenticated: true, active: true, userId });
  });

  it.each([
    null,
    { authenticated: false, active: true, userId },
    { authenticated: true, active: false, userId },
    { authenticated: true, active: true, userId: "not-a-uuid" },
    {
      authenticated: true,
      active: true,
      userId: "00000000-0000-4000-8000-0000000001AA",
    },
  ])("fails closed for invalid resolver output", async (output) => {
    await expect(
      resolveClientPrincipal(
        { resolve: async () => output as never },
        `Bearer ${"A".repeat(32)}`,
      ),
    ).resolves.toBeNull();
  });

  it("maps resolver exceptions to unauthenticated without leaking them", async () => {
    await expect(
      resolveClientPrincipal(
        {
          resolve: async () => {
            throw new Error("secret resolver detail");
          },
        },
        "Bearer hidden",
      ),
    ).resolves.toBeNull();
  });
});
