import { describe, expect, it } from "vitest";

import { CallbackInfrastructureError } from "@ii-tonya/contracts";
import {
  CallbackVerificationError,
  issueExpertCommandCallback,
  verifyExpertCommandCallback,
  type ExpertCommandCallbackClaims,
  type ExpertCommandCallbackClaimsStore,
} from "./callback-token.js";

const secret = new Uint8Array(32).fill(17);
const now = new Date("2026-08-03T12:00:00.000Z");
const claims: ExpertCommandCallbackClaims = {
  kind: "expert_command",
  expertId: "00000000-0000-4000-8000-000000001201",
  operation: "quote_residency",
  objectId: "00000000-0000-4000-8000-000000001202",
  version: 1,
  expiresAtEpochSeconds: Math.floor(now.getTime() / 1_000) + 60,
};
const binding = {
  telegramUserId: "1201",
  expertId: claims.expertId,
  active: true,
  verified: true,
};

const memoryStore = (): ExpertCommandCallbackClaimsStore => {
  const values = new Map<string, ExpertCommandCallbackClaims>();
  return {
    async put(key, value) {
      values.set(key, value);
    },
    async peek(key) {
      return values.get(key) ?? null;
    },
    async consumeIfValid(input) {
      const value = values.get(input.tokenHash);
      if (
        value === undefined ||
        value.expertId !== input.expertId ||
        value.operation !== input.operation ||
        value.objectId !== input.objectId ||
        value.version !== input.version ||
        value.expiresAtEpochSeconds <= Math.floor(input.now.getTime() / 1_000)
      ) {
        return null;
      }
      values.delete(input.tokenHash);
      return value;
    },
  };
};

describe("versioned expert command callback tokens", () => {
  it("binds expert, operation, object, nonce/version, and expiry within 64 bytes", async () => {
    const store = memoryStore();
    const token = await issueExpertCommandCallback(claims, secret, store);
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    await expect(
      verifyExpertCommandCallback(
        token,
        "1201",
        binding,
        { operation: claims.operation, objectId: claims.objectId },
        secret,
        store,
        now,
      ),
    ).resolves.toEqual(claims);
    await expect(
      verifyExpertCommandCallback(
        token,
        "1201",
        binding,
        { operation: claims.operation, objectId: claims.objectId },
        secret,
        store,
        now,
      ),
    ).rejects.toBeInstanceOf(CallbackVerificationError);
  });

  it.each([
    [
      "wrong Telegram identity",
      "1202",
      binding,
      claims.operation,
      claims.objectId,
      now,
    ],
    [
      "inactive binding",
      "1201",
      { ...binding, active: false },
      claims.operation,
      claims.objectId,
      now,
    ],
    [
      "unverified binding",
      "1201",
      { ...binding, verified: false },
      claims.operation,
      claims.objectId,
      now,
    ],
    [
      "cross expert",
      "1201",
      { ...binding, expertId: "00000000-0000-4000-8000-000000001299" },
      claims.operation,
      claims.objectId,
      now,
    ],
    [
      "operation substitution",
      "1201",
      binding,
      "view_referral_summary",
      claims.objectId,
      now,
    ],
    [
      "object substitution",
      "1201",
      binding,
      claims.operation,
      "00000000-0000-4000-8000-000000001299",
      now,
    ],
    [
      "expiry",
      "1201",
      binding,
      claims.operation,
      claims.objectId,
      new Date("2026-08-03T12:01:00.000Z"),
    ],
  ] as const)(
    "rejects %s without consuming the valid token",
    async (
      _name,
      telegramUserId,
      candidateBinding,
      operation,
      objectId,
      candidateNow,
    ) => {
      const store = memoryStore();
      const token = await issueExpertCommandCallback(claims, secret, store);
      await expect(
        verifyExpertCommandCallback(
          token,
          telegramUserId,
          candidateBinding,
          { operation, objectId },
          secret,
          store,
          candidateNow,
        ),
      ).rejects.toBeInstanceOf(CallbackVerificationError);
      if (_name !== "expiry") {
        await expect(
          verifyExpertCommandCallback(
            token,
            "1201",
            binding,
            { operation: claims.operation, objectId: claims.objectId },
            secret,
            store,
            now,
          ),
        ).resolves.toEqual(claims);
      }
    },
  );

  it("preserves infrastructure failures for retry instead of disguising them as auth", async () => {
    const failingStore: ExpertCommandCallbackClaimsStore = {
      async put() {
        throw new CallbackInfrastructureError();
      },
      async peek() {
        throw new CallbackInfrastructureError();
      },
      async consumeIfValid() {
        throw new CallbackInfrastructureError();
      },
    };
    await expect(
      issueExpertCommandCallback(claims, secret, failingStore),
    ).rejects.toBeInstanceOf(CallbackInfrastructureError);
  });
});
