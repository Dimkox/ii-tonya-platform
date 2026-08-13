import { describe, expect, it, vi } from "vitest";
import { deliverSandboxPaymentEvent } from "../../packages/sandbox-payments/src/index.js";

describe("sandbox provider composition boundary", () => {
  it.each([
    ["settled", "settle"],
    ["refunded", "reverse"],
  ] as const)("delivers %s through the existing canonical %s pipeline exactly once before acknowledgement", async (kind, method) => {
    const event = { kind, eventId: `sandbox_event_${"a".repeat(24)}` };
    const adapter = { reconcile: vi.fn().mockResolvedValueOnce(event).mockResolvedValueOnce(null) };
    const inbox = { settle: vi.fn(async () => undefined), reverse: vi.fn(async () => undefined) };
    const acknowledge = vi.fn(async () => undefined);
    await expect(deliverSandboxPaymentEvent({ paymentId: `sandbox_payment_${"b".repeat(24)}`, adapter: adapter as never, inbox: inbox as never, acknowledge })).resolves.toBe(kind);
    expect(inbox[method]).toHaveBeenCalledOnce();
    expect(inbox[method]).toHaveBeenCalledWith(event);
    expect(acknowledge).toHaveBeenCalledWith(event.eventId);
    await expect(deliverSandboxPaymentEvent({ paymentId: `sandbox_payment_${"b".repeat(24)}`, adapter: adapter as never, inbox: inbox as never, acknowledge })).resolves.toBe("none");
    expect(inbox[method]).toHaveBeenCalledOnce();
  });
});
