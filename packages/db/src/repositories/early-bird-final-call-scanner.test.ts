import { describe, expect, it, vi } from "vitest";
import {
  EarlyBirdFinalCallScanner,
  type FinalCallScanStore,
} from "./early-bird-final-call-scanner.js";

const trigger = Date.parse("2026-12-28T07:00:00Z");
const start = Date.parse("2027-01-10T21:00:00Z");
const base = {
  userId: "user",
  paymentStatus: "ONBOARDING_ONLY",
  verified: true,
  messagingConsent: true,
  first: { status: "none" as const },
  repeat: { status: "none" as const },
};
function fixture(nowMs = trigger) {
  const store: FinalCallScanStore = {
    readDueUnqueued: vi.fn().mockResolvedValue({
      nowMs,
      configVersion: "wave-v1",
      phase: "WAVE_1_EARLY_BIRD",
      triggerAtMs: trigger,
      clientStartAtMs: start,
      candidates: [base],
    }),
    enqueueIfCurrent: vi.fn().mockResolvedValue("queued"),
  };
  return { store, scanner: new EarlyBirdFinalCallScanner(store) };
}
describe("durable final-call enqueue", () => {
  it("enqueues the first notice on the configured tick with a bound configuration version", async () => {
    const f = fixture();
    expect(await f.scanner.scan(10)).toEqual({
      examined: 1,
      queued: 1,
      failed: 0,
    });
    expect(f.store.enqueueIfCurrent).toHaveBeenCalledWith({
      userId: "user",
      kind: "first",
      configVersion: "wave-v1",
      triggerAtMs: trigger,
      clientStartAtMs: start,
      scheduledAtMs: trigger,
    });
  });
  it("computes the repeat tick after 72 hours from confirmed delivery", async () => {
    const f = fixture(Date.parse("2027-01-01T09:00:00Z"));
    vi.mocked(f.store.readDueUnqueued).mockResolvedValue({
      nowMs: Date.parse("2027-01-01T09:00:00Z"),
      configVersion: "wave-v1",
      phase: "WAVE_1_EARLY_BIRD",
      triggerAtMs: trigger,
      clientStartAtMs: start,
      candidates: [
        {
          ...base,
          first: {
            status: "delivered",
            deliveredAtMs: Date.parse("2026-12-28T10:00:00Z"),
          },
        },
      ],
    });
    await f.scanner.scan(10);
    expect(f.store.enqueueIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "repeat",
        scheduledAtMs: Date.parse("2027-01-01T07:00:00Z"),
      }),
    );
  });
  it("does not enqueue paid, unverified, unconsented or out-of-phase candidates", async () => {
    const f = fixture();
    vi.mocked(f.store.readDueUnqueued).mockResolvedValue({
      nowMs: trigger,
      configVersion: "wave-v1",
      phase: "PUBLIC_LAUNCH",
      triggerAtMs: trigger,
      clientStartAtMs: start,
      candidates: [base],
    });
    await f.scanner.scan(10);
    expect(f.store.enqueueIfCurrent).not.toHaveBeenCalled();
    vi.mocked(f.store.readDueUnqueued).mockResolvedValue({
      nowMs: trigger,
      configVersion: "wave-v1",
      phase: "WAVE_1_EARLY_BIRD",
      triggerAtMs: trigger,
      clientStartAtMs: start,
      candidates: [
        { ...base, paymentStatus: "FULLY_PREPAID_NO_DISCOUNT" },
        { ...base, verified: false },
        { ...base, messagingConsent: false },
      ],
    });
    await f.scanner.scan(10);
    expect(f.store.enqueueIfCurrent).not.toHaveBeenCalled();
  });
  it("allows the transactional authority to reject a changed state or existing item", async () => {
    const f = fixture();
    vi.mocked(f.store.enqueueIfCurrent).mockResolvedValue("stale");
    expect(await f.scanner.scan(1)).toEqual({
      examined: 1,
      queued: 0,
      failed: 0,
    });
    expect(f.store.enqueueIfCurrent).toHaveBeenCalledOnce();
  });
  it("progresses beyond 50 previously queued residents", async () => {
    const residents = Array.from({ length: 60 }, (_, i) => ({
      ...base,
      userId: `user-${i}`,
    }));
    const queued = new Set<string>();
    const store = {
      readDueUnqueued: async (limit: number) => ({
        nowMs: trigger,
        configVersion: "wave-v1",
        phase: "WAVE_1_EARLY_BIRD",
        triggerAtMs: trigger,
        clientStartAtMs: start,
        candidates: residents
          .filter((r) => !queued.has(r.userId))
          .slice(0, limit),
      }),
      enqueueIfCurrent: async (input: { userId: string }) => {
        queued.add(input.userId);
        return "queued" as const;
      },
    };
    const scanner = new EarlyBirdFinalCallScanner(store);
    expect((await scanner.scan(50)).queued).toBe(50);
    expect((await scanner.scan(50)).queued).toBe(10);
    expect(queued.size).toBe(60);
  });
});
