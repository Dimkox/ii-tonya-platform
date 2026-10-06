import { describe, it, expect } from "vitest";
import { recordWorkerOutboxMetric } from "./metrics.js";
describe("client async metrics", () => {
  it("accepts only the fixed authority-cleanup reason", () => {
    expect(() =>
      recordWorkerOutboxMetric({
        topic: "telegram_send_text",
        phase: "claim",
        outcome: "dead_letter",
        reasonClass: "client_authority_invalid",
      }),
    ).not.toThrow();
    expect(() =>
      recordWorkerOutboxMetric({
        topic: "telegram_send_text",
        phase: "claim",
        outcome: "dead_letter",
        reasonClass: "client_authority_invalid:user-123",
      } as never),
    ).toThrow();
  });
  it("accepts the closed Selarti topic and rejects request identifiers", () => {
    expect(() =>
      recordWorkerOutboxMetric({
        topic: "selarti_request",
        phase: "dispatch",
        outcome: "unknown",
        reasonClass: "internal",
      }),
    ).not.toThrow();
    expect(() =>
      recordWorkerOutboxMetric({
        topic: "sha256:request-id",
        phase: "dispatch",
        outcome: "unknown",
        reasonClass: "internal",
      } as never),
    ).toThrow();
  });
});
