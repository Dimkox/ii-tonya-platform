import { describe, expect, it } from "vitest";
import { sanitizeTraceException } from "./tracing.js";

describe("trace exception sanitization", () => {
  it("drops sensitive message content", () => {
    const result = sanitizeTraceException(Object.assign(new Error("choiceHandle ch1.secret-value"), {
      cause: "raw body",
      stack: "UUID 123e4567-e89b-12d3-a456-426614174000",
    }));
    expect(result).toEqual({ name: "Error", message: "[REDACTED]" });
  });
});
