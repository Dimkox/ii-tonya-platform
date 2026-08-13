import { describe, expect, it } from "vitest";

import {
  ClientViewCallbackVerificationError,
  authenticateClientViewCallback,
  issueClientViewCallback,
  type ClientViewCallbackClaims,
  type ClientViewCallbackStore,
} from "./client-view-callback-token.js";

class MemoryStore implements ClientViewCallbackStore {
  readonly claims = new Map<string, ClientViewCallbackClaims>();
  async put(
    tokenHash: string,
    claims: ClientViewCallbackClaims,
  ): Promise<void> {
    this.claims.set(tokenHash, { ...claims });
  }
  async peek(tokenHash: string): Promise<ClientViewCallbackClaims | null> {
    return this.claims.get(tokenHash) ?? null;
  }
}

const now = new Date("2026-08-13T09:00:00.000Z");
const claims: ClientViewCallbackClaims = {
  reservationId: "00000000-0000-4000-8000-000000000201",
  expertId: "00000000-0000-4000-8000-000000000101",
  version: 3,
  expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 600,
};
const binding = {
  telegramUserId: "123456789",
  expertId: claims.expertId,
  active: true,
  verified: true,
};
const secret = new Uint8Array(32).fill(19);

describe("cv1 client-view callback token", () => {
  it("uses an isolated prefix and stays within Telegram's byte limit", async () => {
    const token = await issueClientViewCallback(
      claims,
      secret,
      new MemoryStore(),
    );
    expect(token).toMatch(/^cv1\./u);
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(64);
    expect(token.startsWith("ct2.")).toBe(false);
  });

  it("authenticates actor, reservation, version, and expiry without consuming", async () => {
    const store = new MemoryStore();
    const token = await issueClientViewCallback(claims, secret, store);

    await expect(
      authenticateClientViewCallback(
        token,
        binding.telegramUserId,
        binding,
        secret,
        store,
        now,
      ),
    ).resolves.toEqual({
      tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      claims,
    });
    expect(store.claims.size).toBe(1);
  });

  it.each([
    [
      "foreign",
      { ...binding, expertId: "00000000-0000-4000-8000-000000000999" },
      now,
    ],
    ["revoked", { ...binding, active: false }, now],
    ["expired", binding, new Date(claims.expiresAtEpochSeconds * 1_000)],
  ] as const)(
    "collapses %s callbacks to one verification error",
    async (_case, candidateBinding, at) => {
      const store = new MemoryStore();
      const token = await issueClientViewCallback(claims, secret, store);
      await expect(
        authenticateClientViewCallback(
          token,
          binding.telegramUserId,
          candidateBinding,
          secret,
          store,
          at,
        ),
      ).rejects.toBeInstanceOf(ClientViewCallbackVerificationError);
    },
  );
});
