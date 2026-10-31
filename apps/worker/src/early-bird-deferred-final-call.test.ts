import { expect, it, vi } from "vitest";
import {
  createDeferredFinalCallJob,
  finalCallResumeMessage,
} from "./early-bird-deferred-final-call.js";
it("uses an honest recapture CTA without claiming read tracking or a ready invoice", () => {
  const message = finalCallResumeMessage({
    subscriptionMinor: "2000",
    clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
  });
  expect(message).toContain("20 ₽/мес");
  expect(message).toContain("10 января 2027");
  expect(message).toContain("заново указать email");
  expect(message).not.toContain("через 2 недели");
  expect(() =>
    finalCallResumeMessage({ subscriptionMinor: "-1", clientStartMs: 0 }),
  ).toThrow();
});
it("persists dispatch before send and never pretends a failed send was delivered", async () => {
  const trace: string[] = [];
  let claims = 0;
  const claim = {
    noticeId: "n",
    attemptId: "a",
    userId: "u",
    kind: "first" as const,
  };
  const store = {
    excludeUnpaid: async () => 0,
    enqueueDue: async () => 1,
    queue: {
      claim: async () => (claims++ === 0 ? claim : null),
      dispatch: async () => {
        trace.push("dispatch");
        return true;
      },
    },
    sendIfCurrent: async (
      _c: typeof claim,
      send: (r: {
        chatId: string;
        subscriptionMinor: string;
        clientStartMs: number;
        callbackData: string;
      }) => Promise<{ messageId: string }>,
    ) => {
      try {
        return {
          kind: "delivered" as const,
          ...(await send({
            chatId: "1",
            subscriptionMinor: "2000",
            clientStartMs: Date.parse("2027-01-11T00:00:00+03:00"),
            callbackData: "eb:choice",
          })),
        };
      } catch {
        return { kind: "uncertain" as const };
      }
    },
    finish: vi.fn(async () => true),
  };
  const job = createDeferredFinalCallJob(store, {
    send: async () => {
      trace.push("send");
      throw new Error("unknown transport");
    },
  });
  expect(await job()).toEqual({
    queued: 1,
    delivered: 0,
    uncertain: 1,
    excluded: 0,
  });
  expect(trace).toEqual(["dispatch", "send"]);
  expect(store.finish).toHaveBeenCalledWith(claim, { kind: "uncertain" });
});
