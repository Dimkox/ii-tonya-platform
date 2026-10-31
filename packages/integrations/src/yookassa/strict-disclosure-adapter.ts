import { StrictDisclosureGate } from "./strict-disclosure-gate.js";

/**
 * Command adapter for a single gateway process. This is deliberately not wired
 * to production: the caller must fence other writers and network egress and
 * recover erasures after process failure. `start` must synchronously begin an
 * actual network write, not merely schedule an asynchronous request.
 */
export class StrictDisclosureAdapter {
  constructor(
    private readonly gate: StrictDisclosureGate,
    private readonly operations: {
      authorize: (subject: string) => Promise<void>;
      start: (subject: string) => Promise<void>;
      erase: (subject: string) => Promise<void>;
    },
  ) {}

  send(subject: string): Promise<"started" | "cancelled"> {
    return this.gate.send(
      subject,
      () => this.operations.authorize(subject),
      () => this.operations.start(subject),
    );
  }

  erase(subject: string): Promise<void> {
    return this.gate.erase(subject, () => this.operations.erase(subject));
  }
}
