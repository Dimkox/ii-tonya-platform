import { createHash } from "node:crypto";

export interface SubmitFeedbackCommand {
  readonly userId: string;
  readonly reservationId?: string;
  readonly score: 1 | 2 | 3 | 4 | 5;
  readonly text?: string;
  readonly sourceEventId: string;
  readonly correlationId: string;
}

export interface FeedbackDependencies {
  readonly feedback: { insertOnce(input: SubmitFeedbackCommand & { text?: string; contentHash: string; negativePolicyVersion: string }): Promise<{ inserted: boolean; feedbackId: string; result: { escalated: boolean } }> };
  readonly outbox: { enqueue(input: { topic: "admin.negative_feedback"; charge: 0; idempotencyKey: string; correlationId: string; payload: { feedbackId: string; contentHash: string; policyVersion: string } }): Promise<void> | void };
  readonly audit: { append(input: { action: "feedback.escalated"; objectId: string; correlationId: string; metadataHash: string }): Promise<void> | void };
}

export const NEGATIVE_FEEDBACK_POLICY_VERSION = "negative-v1";
const MAX_FEEDBACK_TEXT_LENGTH = 2_000;
const explicitNegative = (text: string): boolean => /явно\s+негативн(?:ый|ого)\s+опыт/iu.test(text);
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

export const createFeedbackService = (deps: FeedbackDependencies) => ({
  async submit(command: SubmitFeedbackCommand): Promise<{ feedbackId: string; escalated: boolean }> {
    const text = command.text?.slice(0, MAX_FEEDBACK_TEXT_LENGTH);
    const contentHash = digest(text ?? "");
    const negative = command.score <= 3 || (text !== undefined && explicitNegative(text));
    const stored = await deps.feedback.insertOnce({ ...command, ...(text === undefined ? {} : { text }), contentHash, negativePolicyVersion: NEGATIVE_FEEDBACK_POLICY_VERSION });
    if (stored.inserted && negative) {
      await deps.outbox.enqueue({ topic: "admin.negative_feedback", charge: 0, idempotencyKey: `feedback:${stored.feedbackId}:negative`, correlationId: command.correlationId, payload: { feedbackId: stored.feedbackId, contentHash, policyVersion: NEGATIVE_FEEDBACK_POLICY_VERSION } });
      await deps.audit.append({ action: "feedback.escalated", objectId: stored.feedbackId, correlationId: command.correlationId, metadataHash: digest(`${stored.feedbackId}:${contentHash}:${NEGATIVE_FEEDBACK_POLICY_VERSION}`) });
    }
    return { feedbackId: stored.feedbackId, escalated: stored.result.escalated };
  },
});
