import { describe, expect, it } from "vitest";
import { chargeDelta, choosePackage, derivePackageBalance } from "./billing.js";

const at = new Date("2026-07-28T10:00:00.000Z");
const pkg = (id: string, kind: "admin" | "paid" | "intro", ledgerBalance: number, expiresAt: string | null) => ({
  id,
  kind,
  ledgerBalance,
  expiresAt: expiresAt ? new Date(expiresAt) : null,
  grantedAt: new Date("2026-07-01T00:00:00.000Z"),
});

describe("message charging", () => {
  it("charges accepted and delivered ordinary content but not free classes", () => {
    expect(chargeDelta("ordinary_inbound")).toBe(-1);
    expect(chargeDelta("ordinary_outbound")).toBe(-1);
    expect(chargeDelta("system")).toBe(0);
    expect(chargeDelta("safety")).toBe(0);
    expect(chargeDelta("error")).toBe(0);
  });

  it("uses earliest expiry and keeps intro packages last", () => {
    const chosen = choosePackage([
      pkg("intro", "intro", 10, "2026-07-29T00:00:00.000Z"),
      pkg("late", "admin", 10, "2026-08-10T00:00:00.000Z"),
      pkg("early", "paid", 10, "2026-08-01T00:00:00.000Z"),
    ], at);
    expect(chosen?.id).toBe("early");
  });

  it("ignores empty and expired packages", () => {
    expect(choosePackage([
      pkg("empty", "admin", 0, "2026-08-01T00:00:00.000Z"),
      pkg("expired", "paid", 4, "2026-07-28T09:59:59.999Z"),
    ], at)).toBeNull();
  });

  it("derives balance only from immutable grant, debit, compensation, and revocation facts", () => {
    expect(derivePackageBalance([
      { sequence: 1, kind: "grant", delta: 3, idempotencyKey: "grant-1" },
      { sequence: 2, kind: "debit", delta: -1, idempotencyKey: "debit-1" },
      { sequence: 3, kind: "compensation", delta: 1, idempotencyKey: "compensate-1" },
      { sequence: 4, kind: "revocation", delta: -3, idempotencyKey: "revoke-1" },
    ])).toBe(0);
  });
});
