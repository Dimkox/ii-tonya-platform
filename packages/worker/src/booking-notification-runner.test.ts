import { afterEach, expect, it, vi } from "vitest";
import type { BookingNotificationHttpOutcome } from "@ii-tonya/integrations";
import type { BookingNotificationTopic } from "@ii-tonya/contracts";
import { createBookingNotificationRunner } from "./booking-notification-runner.js";

afterEach(() => vi.useRealTimers());
function fixture(sendEnabled = true) {
  const grant = {
    attemptId: "attempt",
    deliveryId: "delivery",
    botKey: "bot",
    chatId: "201",
    deadline: new Date(Date.now() + 15000).toISOString(),
    wireVersion: 1 as const,
    body: "{}",
    bodySha256: "a".repeat(64),
  };
  const receipt = { botKey: "bot", chatId: "201", messageId: 77 };
  const repository = {
    capturePending: vi.fn(async () => 0),
    recoverExpired: vi.fn(async () => 0),
    claimDeliveries: vi.fn(async () => [
      {
        id: "delivery",
        topic: "client.booking_confirmed" as BookingNotificationTopic,
        reservationId: "reservation",
        leaseToken: "lease",
        workerId: "worker",
      },
    ]),
    admitPrepared: vi.fn(async (): Promise<typeof grant | undefined> => grant),
    resolveReceipt: vi.fn(async () => true),
    recordOutcome: vi.fn(async () => true),
  };
  const callbacks = { issueApprovalPair: vi.fn(async () => null) };
  const transport = {
    sendPrepared: vi.fn(async (): Promise<BookingNotificationHttpOutcome> => ({
      kind: "applied",
      receipt,
    })),
  };
  const runner = createBookingNotificationRunner({
    repository,
    callbacks,
    transport,
    workerId: "worker",
    sendEnabled,
  });
  return { runner, repository, transport, callbacks, receipt, grant };
}
it("consumes one grant and sends once per cycle", async () => {
  const f = fixture();
  await f.runner.runOnce();
  expect(f.repository.claimDeliveries).toHaveBeenCalledWith(1, "worker");
  expect(f.transport.sendPrepared).toHaveBeenCalledExactlyOnceWith(f.grant);
  expect(f.repository.resolveReceipt).toHaveBeenCalledWith(
    "attempt",
    f.receipt,
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it.each([
  { kind: "not_applied", retryAfterSeconds: 7200 },
  { kind: "failed", reasonCode: "bot_rejected", pauseBot: true },
  { kind: "unknown", reasonCode: "delivery_uncertain", pauseBot: true },
] satisfies BookingNotificationHttpOutcome[])(
  "retains full $kind outcome across failed persistence",
  async (outcome) => {
    const f = fixture();
    f.transport.sendPrepared.mockResolvedValue(outcome);
    f.repository.recordOutcome.mockRejectedValueOnce(new Error("SQL"));
    await f.runner.runOnce();
    await f.runner.runOnce();
    expect(f.repository.recordOutcome).toHaveBeenNthCalledWith(
      1,
      "attempt",
      outcome,
    );
    expect(f.repository.recordOutcome).toHaveBeenNthCalledWith(
      2,
      "attempt",
      outcome,
    );
    expect(f.transport.sendPrepared).toHaveBeenCalledTimes(1);
  },
);
it("records a thrown transport as unknown without another HTTP call", async () => {
  const f = fixture();
  f.transport.sendPrepared.mockRejectedValue(new Error("network"));
  f.repository.recordOutcome.mockResolvedValue(false);
  await f.runner.runOnce();
  await f.runner.runOnce();
  expect(f.repository.recordOutcome).toHaveBeenCalledWith("attempt", {
    kind: "unknown",
    reasonCode: "delivery_uncertain",
  });
  expect(f.transport.sendPrepared).toHaveBeenCalledTimes(1);
});
it.each(["denied", "error"])("sends nothing on admission %s", async (kind) => {
  const f = fixture();
  if (kind === "denied")
    f.repository.admitPrepared.mockResolvedValue(undefined);
  else f.repository.admitPrepared.mockRejectedValue(new Error("DB"));
  await f.runner.runOnce();
  expect(f.transport.sendPrepared).not.toHaveBeenCalled();
});
it("recovers with sending disabled", async () => {
  const f = fixture(false);
  await f.runner.runOnce();
  expect(f.repository.recoverExpired).toHaveBeenCalledOnce();
  expect(f.repository.claimDeliveries).not.toHaveBeenCalled();
});
it("does not issue buttons for a confirmation", async () => {
  const f = fixture();
  await f.runner.runOnce();
  expect(f.callbacks.issueApprovalPair).not.toHaveBeenCalled();
});
it("issues buttons before request admission", async () => {
  const f = fixture();
  const claims = await f.repository.claimDeliveries();
  claims[0]!.topic = "telegram.reservation_request";
  f.repository.claimDeliveries.mockClear().mockResolvedValue(claims);
  await f.runner.runOnce();
  expect(f.callbacks.issueApprovalPair).toHaveBeenCalledExactlyOnceWith(
    "delivery",
  );
  expect(
    f.callbacks.issueApprovalPair.mock.invocationCallOrder[0],
  ).toBeLessThan(f.repository.admitPrepared.mock.invocationCallOrder[0]!);
});
it("does not admit a historical claim without topic", async () => {
  const f = fixture();
  const claims = await f.repository.claimDeliveries();
  Reflect.deleteProperty(claims[0]!, "topic");
  f.repository.claimDeliveries.mockClear().mockResolvedValue(claims);
  await f.runner.runOnce();
  expect(f.repository.admitPrepared).not.toHaveBeenCalled();
  expect(f.transport.sendPrepared).not.toHaveBeenCalled();
});
it("serializes drain and cycle persistence", async () => {
  const f = fixture();
  f.repository.resolveReceipt.mockRejectedValueOnce(new Error("SQL"));
  await f.runner.runOnce();
  const save = deferred<boolean>();
  const started = deferred<void>();
  f.repository.resolveReceipt.mockImplementation(async () => {
    started.resolve();
    return save.promise;
  });
  const d1 = f.runner.drain(Date.now() + 10000);
  await started.promise;
  const d2 = f.runner.drain(Date.now() + 10000);
  const cycle = f.runner.runOnce();
  await Promise.resolve();
  expect(f.repository.resolveReceipt).toHaveBeenCalledTimes(2);
  save.resolve(true);
  await Promise.all([d1, d2, cycle]);
  expect(f.transport.sendPrepared).toHaveBeenCalledTimes(1);
});
it("does not start SQL after drain deadline when HTTP completes late", async () => {
  const f = fixture();
  const response = deferred<BookingNotificationHttpOutcome>();
  const started = deferred<void>();
  f.transport.sendPrepared.mockImplementation(async () => {
    started.resolve();
    return response.promise;
  });
  const cycle = f.runner.runOnce();
  await started.promise;
  vi.useFakeTimers();
  const drain = f.runner.drain(Date.now() + 100);
  await vi.advanceTimersByTimeAsync(100);
  await drain;
  response.resolve({ kind: "applied", receipt: f.receipt });
  await cycle;
  await f.runner.runOnce();
  expect(f.repository.resolveReceipt).not.toHaveBeenCalled();
  expect(f.repository.claimDeliveries).toHaveBeenCalledTimes(1);
});
it("retries only receipt persistence after SQL failure", async () => {
  const f = fixture();
  f.repository.resolveReceipt.mockRejectedValueOnce(new Error("SQL"));
  expect((await f.runner.runOnce()).pendingCompletion).toBe(true);
  await f.runner.runOnce();
  expect(f.transport.sendPrepared).toHaveBeenCalledTimes(1);
  expect(f.repository.resolveReceipt).toHaveBeenCalledTimes(2);
});
it("keeps a rejected completion pending without another send", async () => {
  const f = fixture();
  f.repository.resolveReceipt.mockResolvedValue(false);
  await f.runner.runOnce();
  await f.runner.runOnce();
  expect(f.transport.sendPrepared).toHaveBeenCalledTimes(1);
});
it("stops new claims but continues receipt recovery", async () => {
  const f = fixture();
  f.repository.resolveReceipt.mockRejectedValueOnce(new Error("SQL"));
  await f.runner.runOnce();
  f.runner.stopAccepting();
  await f.runner.runOnce();
  expect(f.repository.resolveReceipt).toHaveBeenCalledTimes(2);
  expect(f.repository.claimDeliveries).toHaveBeenCalledTimes(1);
});
it("coalesces overlapping cycles without another claim", async () => {
  const f = fixture();
  await Promise.all([f.runner.runOnce(), f.runner.runOnce()]);
  expect(f.transport.sendPrepared).toHaveBeenCalledTimes(1);
});
it("never sends after stop during admission", async () => {
  const f = fixture();
  f.repository.admitPrepared.mockImplementation(async () => {
    f.runner.stopAccepting();
    return f.grant;
  });
  await f.runner.runOnce();
  expect(f.transport.sendPrepared).not.toHaveBeenCalled();
  expect(f.repository.recordOutcome).toHaveBeenCalledWith("attempt", {
    kind: "not_applied",
  });
});
