import { describe, expect, it } from "vitest";
import { sanitizeTraceException } from "./tracing.js";

describe("trace exception sanitization", () => {
  it("drops sensitive message content", () => {
    const result = sanitizeTraceException(Object.assign(new Error("choiceHandle ch1.secret-value"), {
      cause: "raw body",
      stack: "UUID 123e4567-e89b-12d3-a456-426614174000",
    }));
    expect(result).toEqual({ name: "ClientConversationError", message: "operation_failed" });
    expect(JSON.stringify(result)).not.toContain("choiceHandle");
    expect(JSON.stringify(result)).not.toContain("raw body");
    expect(JSON.stringify(result)).not.toContain("UUID");
  });

  it("uses the same fixed exception for arbitrary values", () => {
    expect(sanitizeTraceException({ name: "evil", message: "free text", cause: "secret", stack: "raw" }))
      .toEqual({ name: "ClientConversationError", message: "operation_failed" });
  });
});
