import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createExpertBearerPrincipalResolver,
  type ExpertSessionRecord,
} from "./expert-principal-resolver.js";

const token = `es1.${Buffer.alloc(32, 17).toString("base64url")}`;
const authorization = `Bearer ${token}`;
const now = new Date("2026-08-12T09:00:00.000Z");
const validSession = (): ExpertSessionRecord => ({
  userId: "00000000-0000-4000-8000-0000000000AA",
  expertId: "00000000-0000-4000-8000-0000000000BB",
  expiresAt: new Date("2026-08-12T10:00:00.000Z"),
});

describe("expert bearer principal resolver", () => {
  it("hashes a valid token and emits only a normalized principal", async () => {
    const findByTokenHash = vi.fn(async () => validSession());
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).resolves.toEqual({
      authenticated: true,
      userId: "00000000-0000-4000-8000-0000000000aa",
      expertId: "00000000-0000-4000-8000-0000000000bb",
    });
    expect(findByTokenHash).toHaveBeenCalledWith(
      `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`,
    );
  });

  it.each([
    undefined,
    "",
    `bearer ${token}`,
    `Bearer  ${token}`,
    `Bearer ${"A".repeat(31)}`,
    `Bearer ${"A".repeat(513)}`,
    `Bearer ${"A".repeat(31)}!`,
  ])("rejects malformed authorization without lookup: %s", async (header) => {
    const findByTokenHash = vi.fn(async () => validSession());
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash },
      now: () => now,
    });

    await expect(resolver.resolve(header)).resolves.toBeNull();
    expect(findByTokenHash).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "expired at equality",
      session: { ...validSession(), expiresAt: now },
    },
    {
      name: "expired before now",
      session: {
        ...validSession(),
        expiresAt: new Date("2026-08-12T08:59:59.999Z"),
      },
    },
    {
      name: "revoked",
      session: {
        ...validSession(),
        revokedAt: new Date("2026-08-12T08:00:00Z"),
      },
    },
    {
      name: "invalid expiry",
      session: { ...validSession(), expiresAt: new Date(Number.NaN) },
    },
    {
      name: "invalid user id",
      session: { ...validSession(), userId: "not-a-uuid" },
    },
    {
      name: "invalid expert id",
      session: { ...validSession(), expertId: "not-a-uuid" },
    },
  ])("fails closed for $name", async ({ session }) => {
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash: async () => session },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).resolves.toBeNull();
  });

  it("performs a fresh session lookup for every request", async () => {
    const findByTokenHash = vi
      .fn<() => Promise<ExpertSessionRecord | null>>()
      .mockResolvedValueOnce(validSession())
      .mockResolvedValueOnce(null);
    const resolver = createExpertBearerPrincipalResolver({
      sessions: { findByTokenHash },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).resolves.not.toBeNull();
    await expect(resolver.resolve(authorization)).resolves.toBeNull();
    expect(findByTokenHash).toHaveBeenCalledTimes(2);
  });

  it("replaces lookup failures with a fixed error", async () => {
    const resolver = createExpertBearerPrincipalResolver({
      sessions: {
        findByTokenHash: async () => {
          throw new Error(`provider leaked ${token}`);
        },
      },
      now: () => now,
    });

    await expect(resolver.resolve(authorization)).rejects.toThrow(
      "expert_session_lookup_failed",
    );
    await expect(resolver.resolve(authorization)).rejects.not.toThrow(token);
  });
});
