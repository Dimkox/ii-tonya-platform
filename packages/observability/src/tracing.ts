import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { sanitizeTelemetry } from "./logger.js";

const tracer = trace.getTracer("ii-tonya");
let shutdownHandler: () => Promise<void> = async () => undefined;

export function registerTelemetryShutdown(handler: () => Promise<void>): void {
  shutdownHandler = handler;
}

export async function shutdownTelemetry(): Promise<void> {
  await shutdownHandler();
}

export function sanitizeTraceException(error: unknown): Record<string, string> {
  const value = error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError", message: String(error) };
  const sanitized = sanitizeTelemetry(value) as Record<string, unknown>;
  return {
    name: typeof sanitized.name === "string" ? sanitized.name : "[REDACTED]",
    message: typeof sanitized.message === "string" ? sanitized.message : "[REDACTED]",
  };
}

export async function traced<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(sanitizeTraceException(error));
      throw error;
    } finally {
      span.end();
    }
  });
}
