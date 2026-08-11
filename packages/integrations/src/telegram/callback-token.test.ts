import { describe, expect, it } from "vitest";

import {
  authenticateCallback,
  CallbackVerificationError,
  issueCallback,
  toExpertCallbackBinding,
  verifyCallback,
  type CallbackClaimsStore,
  type ExpertCallbackClaims,
} from "./callback-token.js";

class MemoryCallbackStore implements CallbackClaimsStore {
  readonly claims = new Map<string, ExpertCallbackClaims>();

  async put(tokenHash: string, claims: ExpertCallbackClaims): Promise<void> {
    this.claims.set(tokenHash, { ...claims });
  }

  async peek(tokenHash: string): Promise<ExpertCallbackClaims | null> {
    const claims = this.claims.get(tokenHash);
    return claims === undefined ? null : { ...claims };
  }

  async consumeIfValid(input: {
    tokenHash: string;
    expertId: string;
    action: "confirm" | "cancel";
    version: number;
    now: Date;
  }): Promise<ExpertCallbackClaims | null> {
    const claims = this.claims.get(input.tokenHash);
    if (
      claims === undefined ||
      claims.expertId !== input.expertId ||
      claims.action !== input.action ||
      claims.version !== input.version ||
      claims.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)
    ) {
      return null;
    }
    this.claims.delete(input.tokenHash);
    return { ...claims };
  }
}

const secret = new Uint8Array(32).fill(7);
const now = new Date("2026-08-11T06:00:00.000Z");
const claims: ExpertCallbackClaims = {
  reservationId: "00000000-0000-4000-8000-000000000201",
  expertId: "00000000-0000-4000-8000-000000000002",
  action: "confirm",
  version: 2,
  expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 300,
};
const binding = {
  telegramUserId: "123456789",
  expertId: claims.expertId,
  active: true,
  verified: true,
};

describe("Telegram callback token", () => {
  it("binds expert, operation, object, nonce, and expiry", async () => {
    const store = new MemoryCallbackStore();
    const token = await issueCallback(claims, secret, store);
    const authenticated = await authenticateCallback(
      token,
      binding.telegramUserId,
      binding,
      secret,
      store,
      now,
    );

    expect(toExpertCallbackBinding(authenticated)).toEqual({
      expertId: claims.expertId,
      operation: "confirm",
      objectId: claims.reservationId,
      nonceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      expiresAtEpochSeconds: claims.expiresAtEpochSeconds,
    });
  });

  it("rejects a callback presented by another expert", async () => {
    const store = new MemoryCallbackStore();
    const token = await issueCallback(claims, secret, store);

    await expect(
      authenticateCallback(
        token,
        binding.telegramUserId,
        { ...binding, expertId: "00000000-0000-4000-8000-000000000999" },
        secret,
        store,
        now,
      ),
    ).rejects.toBeInstanceOf(CallbackVerificationError);
  });

  it("rejects expiry at equality", async () => {
    const store = new MemoryCallbackStore();
    const expiring = {
      ...claims,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000),
    };
    const token = await issueCallback(expiring, secret, store);

    await expect(
      authenticateCallback(
        token,
        binding.telegramUserId,
        binding,
        secret,
        store,
        now,
      ),
    ).rejects.toBeInstanceOf(CallbackVerificationError);
  });

  it("consumes a callback only once", async () => {
    const store = new MemoryCallbackStore();
    const token = await issueCallback(claims, secret, store);

    await expect(
      verifyCallback(
        token,
        binding.telegramUserId,
        binding,
        secret,
        store,
        now,
      ),
    ).resolves.toEqual(claims);
    await expect(
      verifyCallback(
        token,
        binding.telegramUserId,
        binding,
        secret,
        store,
        now,
      ),
    ).rejects.toBeInstanceOf(CallbackVerificationError);
  });
});
