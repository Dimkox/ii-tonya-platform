import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createClientPrincipalResolver,
  resolveClientPrincipal,
} from "./client-principal-resolver.js";

const userId = "00000000-0000-4000-8000-000000000101";
const token = `cs1.${"A".repeat(43)}` as const;

describe("client principal resolver boundary", () => {
  it("hashes one canonical bearer and returns only a fresh minimal principal", async () => {
    const resolve = vi.fn(async () => ({
      kind: "resolved" as const,
      principal: { authenticated: true as const, active: true as const, userId },
    }));
    const resolver = createClientPrincipalResolver({ resolve });

    await expect(resolver.resolve(`Bearer ${token}`)).resolves.toEqual({
      kind: "resolved",
      principal: { authenticated: true, active: true, userId },
    });
    expect(resolve).toHaveBeenCalledWith(
      `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`,
    );
  });

  it.each([undefined, "Bearer invalid", `bearer ${token}`, `Bearer ${token}=`])(
    "denies malformed bearer before repository access",
    async (authorization) => {
      const resolve = vi.fn();
      const resolver = createClientPrincipalResolver({ resolve } as never);
      await expect(resolver.resolve(authorization as never)).resolves.toEqual({
        kind: "denied",
      });
      expect(resolve).not.toHaveBeenCalled();
    },
  );

  it("distinguishes repository outage from denied authority without leaking its cause", async () => {
    const resolver = createClientPrincipalResolver({
      resolve: async () => {
        throw new Error("private database detail");
      },
    });
    await expect(resolver.resolve(`Bearer ${token}`)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it.each([
    { kind: "resolved", principal: { authenticated: false, active: true, userId } },
    { kind: "resolved", principal: { authenticated: true, active: false, userId } },
    { kind: "resolved", principal: { authenticated: true, active: true, userId: "bad" } },
    { kind: "other" },
  ])("denies hostile resolver output", async (output) => {
    await expect(
      resolveClientPrincipal({ resolve: async () => output as never }, `Bearer ${token}`),
    ).resolves.toEqual({ kind: "denied" });
  });
});
