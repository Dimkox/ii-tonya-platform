export interface SubmitFeedbackCommand {
  readonly userId: string;
  readonly reservationId?: string;
  readonly score: 1 | 2 | 3 | 4 | 5;
  readonly text?: string;
  readonly sourceEventId: string;
  readonly correlationId: string;
}

export interface FeedbackTransactionGate {
  submitFeedbackTransaction(
    command: SubmitFeedbackCommand,
  ): Promise<{ feedbackId: string; escalated: boolean }>;
}

export interface FeedbackDependencies {
  readonly workflow: FeedbackTransactionGate;
}

export const createFeedbackService = (deps: FeedbackDependencies) => ({
  async submit(
    command: SubmitFeedbackCommand,
  ): Promise<{ feedbackId: string; escalated: boolean }> {
    return deps.workflow.submitFeedbackTransaction({
      ...command,
      ...(command.text === undefined
        ? {}
        : { text: command.text.slice(0, 2_000) }),
    });
  },
});
