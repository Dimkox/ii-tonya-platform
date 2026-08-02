import { describe, expect, it, vi } from "vitest";
import { createFeedbackService } from "./feedback-service.js";

describe("feedback", () => {
  it("uses one named transaction gate and never composes feedback, outbox, and audit ports", async () => {
    const workflow = { submitFeedbackTransaction: vi.fn().mockResolvedValue({ feedbackId: "f-2", escalated: true }) };
    const secret = "raw private feedback";
    await expect(createFeedbackService({ workflow }).submit({ userId: "u-1", score: 1, text: `${secret}${"x".repeat(2_100)}`, sourceEventId: "feedback-bounded", correlationId: "corr-bounded" })).resolves.toEqual({ feedbackId: "f-2", escalated: true });
    expect(workflow.submitFeedbackTransaction).toHaveBeenCalledTimes(1);
    const command = workflow.submitFeedbackTransaction.mock.calls[0]?.[0];
    expect(command.text).toHaveLength(2_000);
    expect(command.text).toContain(secret);
  });
});
