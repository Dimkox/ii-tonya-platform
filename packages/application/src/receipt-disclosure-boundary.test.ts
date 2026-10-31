import { describe, expect, it, vi } from "vitest";
import { createReceiptDisclosureBoundary } from "./receipt-disclosure-boundary.js";

describe("receipt disclosure boundary", () => {
  it("runs user withdrawal after gateway revocation", async () => {
    const order: string[] = [];
    const boundary = createReceiptDisclosureBoundary({
      checkoutEnabled: true,
      gateway: {
        revokeUser: async () => {
          order.push("revoke");
        },
        stopAll: async () => {},
      },
    });
    expect(
      await boundary.withdraw("user", async () => {
        order.push("db");
        return 7;
      }),
    ).toBe(7);
    expect(order).toEqual(["revoke", "db"]);
  });
  it("stops all sends before a cleanup whose subjects are not yet known", async () => {
    const order: string[] = [];
    const boundary = createReceiptDisclosureBoundary({
      checkoutEnabled: true,
      gateway: {
        revokeUser: async () => {},
        stopAll: async () => {
          order.push("stop");
        },
      },
    });
    await boundary.cleanup(async () => {
      order.push("cleanup");
    });
    expect(order).toEqual(["stop", "cleanup"]);
  });
  it("rejects enabling checkout without a gateway", () => {
    expect(() =>
      createReceiptDisclosureBoundary({ checkoutEnabled: true }),
    ).toThrow();
  });
  it("does not prevent a privacy mutation when gateway revocation fails", async () => {
    const change = vi.fn(async () => 1);
    const boundary = createReceiptDisclosureBoundary({
      checkoutEnabled: true,
      gateway: {
        revokeUser: async () => {
          throw Error("gateway unavailable");
        },
        stopAll: async () => {},
      },
    });
    await expect(boundary.withdraw("user", change)).rejects.toThrow(
      "gateway cancellation uncertain",
    );
    expect(change).toHaveBeenCalledOnce();
  });
  it("stops all sends if user revocation fails", async () => {
    const stopAll = vi.fn(async () => {});
    const boundary = createReceiptDisclosureBoundary({
      checkoutEnabled: true,
      gateway: {
        revokeUser: async () => {
          throw Error("gateway unavailable");
        },
        stopAll,
      },
    });
    await expect(boundary.withdraw("user", async () => 1)).rejects.toThrow(
      "gateway cancellation uncertain",
    );
    expect(stopAll).toHaveBeenCalledOnce();
  });
  it("permits mutation directly when checkout is disabled", async () => {
    const boundary = createReceiptDisclosureBoundary({
      checkoutEnabled: false,
    });
    await expect(boundary.cleanup(async () => 3)).resolves.toBe(3);
  });
});
