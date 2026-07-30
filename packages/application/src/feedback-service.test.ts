import { describe, expect, it, vi } from "vitest";
import { createFeedbackService } from "./feedback-service.js";

describe("feedback", () => {
  it.each([
    [1, "Нейтральный текст"],
    [2, "Нейтральный текст"],
    [3, "Нейтральный текст"],
    [4, "Это явно негативный опыт"],
  ] as const)("deduplicates and escalates score %s or explicit negative text for free", async (score, text) => {
    const feedback = { insertOnce: vi.fn()
      .mockResolvedValueOnce({ inserted: true, feedbackId: "f-1", result: { escalated: true } })
      .mockResolvedValueOnce({ inserted: false, feedbackId: "f-1", result: { escalated: true } }) };
    const outbox = { enqueue: vi.fn() };
    const audit = { append: vi.fn() };
    const service = createFeedbackService({ feedback, outbox, audit });
    const command = { userId: "u-1", reservationId: "r-1", score, text, sourceEventId: `feedback-${score}`, correlationId: "corr-1" };
    await service.submit(command);
    await service.submit(command);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({ topic: "admin.negative_feedback", charge: 0, idempotencyKey: "feedback:f-1:negative" }));
    expect(audit.append).toHaveBeenCalledTimes(1);
  });

  it("bounds text and never forwards raw feedback text to audit or outbox", async () => {
    const feedback = { insertOnce: vi.fn().mockResolvedValue({ inserted: true, feedbackId: "f-2", result: { escalated: true } }) };
    const outbox = { enqueue: vi.fn() };
    const audit = { append: vi.fn() };
    const secret = "raw private feedback";
    await createFeedbackService({ feedback, outbox, audit }).submit({ userId: "u-1", score: 1, text: `${secret}${"x".repeat(2_100)}`, sourceEventId: "feedback-bounded", correlationId: "corr-bounded" });
    expect(feedback.insertOnce).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/^raw private feedback/), contentHash: expect.any(String) }));
    expect(feedback.insertOnce.mock.calls[0]?.[0].text).toHaveLength(2_000);
    expect(JSON.stringify(outbox.enqueue.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain(secret);
  });
});
