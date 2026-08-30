export type WarmupState = "start" | "specialization" | "complete";
export type WarmupQualification = {
  readonly name?: string;
  readonly specialization: string;
};
export type WarmupResult = {
  readonly state: WarmupState;
  readonly trialUnits: 0;
  readonly qualification?: WarmupQualification;
  readonly error?: "incomplete_qualification";
};

export class WarmupStateMachine {
  next(input: { state: WarmupState; answer: string }): WarmupResult {
    const answer = input.answer.trim();
    if (input.state === "start")
      return answer.length === 0
        ? { state: "start", trialUnits: 0, error: "incomplete_qualification" }
        : {
            state: "specialization",
            trialUnits: 0,
            qualification: { name: answer, specialization: "" },
          };
    if (input.state === "specialization")
      return answer.length === 0
        ? {
            state: "specialization",
            trialUnits: 0,
            error: "incomplete_qualification",
          }
        : {
            state: "complete",
            trialUnits: 0,
            qualification: { specialization: answer },
          };
    return { state: "complete", trialUnits: 0 };
  }
}
