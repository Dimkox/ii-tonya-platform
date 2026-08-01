import { describe, expect, it } from "vitest";
import { createWindowedRateLimiter } from "./rate-limit.js";

describe("windowed rate limiter", () => {
  it("recovers after the window and isolates provider/auth/IP keys", () => {
    let now = 1_000;
    const limiter = createWindowedRateLimiter({ now: () => now, maxKeys: 8 });
    expect(limiter.consume("telegram:auth:1", 1, 1_000)).toBe(true);
    expect(limiter.consume("telegram:auth:1", 1, 1_000)).toBe(false);
    expect(limiter.consume("telegram:unauth:1", 1, 1_000)).toBe(true);
    expect(limiter.consume("selarti:auth:1", 1, 1_000)).toBe(true);
    expect(limiter.consume("telegram:auth:2", 1, 1_000)).toBe(true);
    now += 1_000;
    expect(limiter.consume("telegram:auth:1", 1, 1_000)).toBe(true);
  });
});
