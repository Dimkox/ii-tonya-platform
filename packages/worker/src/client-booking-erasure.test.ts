import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("client booking erasure concurrency protocol", () => {
  it("fences the zero-active proof and phase advance under the client lock", () => {
    const source = readFileSync(
      "packages/worker/src/client-booking-erasure.ts",
      "utf8",
    );
    const cancel = source.slice(
      source.indexOf("const processCancel"),
      source.indexOf("const processCleanup"),
    );
    const transaction = cancel.indexOf("db.transaction");
    const fence = cancel.indexOf("for update of w", transaction);
    const clientLock = cancel.indexOf("client:${claim.userId}", fence);
    const zeroActive = cancel.indexOf(
      "status in ('reserved','booked')",
      clientLock,
    );
    const advance = cancel.indexOf("phase='cleanup_public'", zeroActive);
    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(fence).toBeGreaterThan(transaction);
    expect(clientLock).toBeGreaterThan(fence);
    expect(zeroActive).toBeGreaterThan(clientLock);
    expect(advance).toBeGreaterThan(zeroActive);
  });

  it("recovers cleanup to cancellation when an active booking is observed", () => {
    const source = readFileSync(
      "packages/worker/src/client-booking-erasure.ts",
      "utf8",
    );
    const cleanup = source.slice(source.indexOf("const processCleanup"));
    const active = cleanup.indexOf("active.rows.length !== 0");
    const recovery = cleanup.indexOf("phase='cancel_active'", active);
    const complete = cleanup.indexOf("phase='complete'", active);
    expect(active).toBeGreaterThanOrEqual(0);
    expect(recovery).toBeGreaterThan(active);
    expect(complete).toBeGreaterThan(recovery);
  });
});
