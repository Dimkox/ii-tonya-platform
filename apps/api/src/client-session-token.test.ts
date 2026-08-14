import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  clientSessionTokenHash,
  createClientSessionToken,
  parseClientBearer,
} from "./client-session-token.js";

describe("client session bearer boundary", () => {
  it("requests exactly 32 random bytes and emits canonical unpadded base64url", () => {
    const random = vi.fn((size: number) => Buffer.alloc(size, 0xff));

    const token = createClientSessionToken(random);

    expect(random).toHaveBeenCalledOnce();
    expect(random).toHaveBeenCalledWith(32);
    expect(token).toMatch(/^cs1\.[A-Za-z0-9_-]{43}$/u);
    expect(token).not.toContain("=");
  });

  it.each([
    undefined,
    ["Bearer cs1." + "A".repeat(43)],
    "",
    "bearer cs1." + "A".repeat(43),
    "Bearer  cs1." + "A".repeat(43),
    "Bearer cs1." + "A".repeat(43) + "=",
    "Bearer cs1." + "A".repeat(43) + " suffix",
    "Bearer cs1." + "A".repeat(43) + ",Bearer cs1." + "B".repeat(43),
  ])("rejects a non-canonical authorization value", (authorization) => {
    expect(parseClientBearer(authorization)).toBeNull();
  });

  it("parses and hashes only one canonical bearer", () => {
    const token = `cs1.${"A".repeat(43)}` as const;
    expect(parseClientBearer(`Bearer ${token}`)).toBe(token);
    expect(clientSessionTokenHash(token)).toBe(
      `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`,
    );
  });
});
