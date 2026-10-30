import { describe, expect, it, vi } from "vitest";
import {
  EarlyBirdFinalCallRunner,
  type FinalCallStore,
  type FinalCallSender,
} from "./early-bird-final-call-runner.js";

function fixture() {
  const claim = {
    noticeId: "notice",
    attemptId: "attempt",
    userId: "user",
    kind: "first" as const,
  };
  const candidate = {
    name: "Анна",
    clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
    triggerAtMs: Date.parse("2026-12-28T07:00:00Z"),
    configVersion: "wave1-v1",
    basePriceMinor: 800000n,
    checkoutUrl: "https://yookassa.ru/pay",
    paymentId: "payment",
  };
  const store: FinalCallStore = {
    claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),
    prepare: vi.fn().mockResolvedValue({ kind: "ready", candidate }),
    dispatch: vi.fn().mockResolvedValue(true),
    finish: vi.fn().mockResolvedValue(true),
  };
  const sender: FinalCallSender = {
    strictAuthority: true,
    sendIfAuthorized: vi
      .fn()
      .mockResolvedValue({ kind: "delivered", messageId: "123" }),
  };
  return { claim, candidate, store, sender };
}

describe("final call delivery orchestration", () => {
  it("marks dispatch before sending the verified base-price checkout", async () => {
    const f = fixture();
    const seen: string[] = [];
    vi.mocked(f.store.dispatch).mockImplementation(async () => {
      seen.push("dispatch");
      return true;
    });
    vi.mocked(f.sender.sendIfAuthorized).mockImplementation(async () => {
      seen.push("send");
      return { kind: "delivered", messageId: "123" };
    });
    const result = await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
      10,
      new AbortController().signal,
    );
    expect(result).toEqual({ delivered: 1, uncertain: 0 });
    expect(seen).toEqual(["dispatch", "send"]);
    expect(f.sender.sendIfAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({
        claim: f.claim,
        paymentId: "payment",
        basePriceMinor: 800000n,
        clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
        triggerAtMs: Date.parse("2026-12-28T07:00:00Z"),
        configVersion: "wave1-v1",
        checkoutUrl: "https://yookassa.ru/pay",
        text: expect.stringContaining("8 000 ₽/мес"),
      }),
      expect.any(AbortSignal),
    );
    expect(f.store.finish).toHaveBeenCalledWith(f.claim, {
      kind: "delivered",
      messageId: "123",
    });
  });

  it("does not send if the resident became ineligible", async () => {
    const f = fixture();
    vi.mocked(f.store.prepare).mockResolvedValue({ kind: "ineligible" });
    await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
      1,
      new AbortController().signal,
    );
    expect(f.sender.sendIfAuthorized).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith(f.claim, { kind: "cancelled" });
  });

  it("retries a temporarily unavailable checkout instead of cancelling", async () => {
    const f = fixture();
    vi.mocked(f.store.prepare).mockResolvedValue({ kind: "pending" });
    await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
      1,
      new AbortController().signal,
    );
    expect(f.sender.sendIfAuthorized).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith(f.claim, { kind: "retry" });
  });

  it("retains an uncertain delivery and does not retry it inside the run", async () => {
    const f = fixture();
    vi.mocked(f.sender.sendIfAuthorized).mockRejectedValue(
      new Error("network unknown"),
    );
    const result = await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
      3,
      new AbortController().signal,
    );
    expect(result).toEqual({ delivered: 0, uncertain: 1 });
    expect(f.store.finish).toHaveBeenCalledWith(f.claim, { kind: "uncertain" });
    expect(f.sender.sendIfAuthorized).toHaveBeenCalledTimes(1);
  });

  it("treats cancellation after dispatch as uncertain without proof of no send", async () => {
    const f = fixture();
    vi.mocked(f.sender.sendIfAuthorized).mockResolvedValue({
      kind: "cancelled",
    });
    expect(
      await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
        1,
        new AbortController().signal,
      ),
    ).toEqual({ delivered: 0, uncertain: 1 });
    expect(f.store.finish).toHaveBeenCalledWith(f.claim, { kind: "uncertain" });
  });

  it("does not report delivery when its receipt could not be persisted", async () => {
    const f = fixture();
    vi.mocked(f.store.finish).mockResolvedValue(false);
    expect(
      await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
        1,
        new AbortController().signal,
      ),
    ).toEqual({ delivered: 0, uncertain: 1 });
  });

  it("does not transmit malformed payment links or send after cancellation", async () => {
    const f = fixture();
    vi.mocked(f.store.prepare).mockResolvedValue({
      kind: "ready",
      candidate: { ...f.candidate, checkoutUrl: "https://evil.example/pay" },
    });
    await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
      1,
      new AbortController().signal,
    );
    expect(f.sender.sendIfAuthorized).not.toHaveBeenCalled();
    expect(f.store.finish).toHaveBeenCalledWith(f.claim, { kind: "cancelled" });
    const aborted = new AbortController();
    aborted.abort();
    await new EarlyBirdFinalCallRunner(f.store, f.sender).run(
      1,
      aborted.signal,
    );
    expect(f.store.claim).toHaveBeenCalledTimes(1);
  });

  it("never sends if no authority-capable sender is configured", async () => {
    const f = fixture();
    await new EarlyBirdFinalCallRunner(f.store, undefined).run(
      1,
      new AbortController().signal,
    );
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.sender.sendIfAuthorized).not.toHaveBeenCalled();
  });
});
