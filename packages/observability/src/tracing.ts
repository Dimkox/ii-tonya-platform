import { SpanStatusCode, trace, type Exception, type Span } from "@opentelemetry/api";

const tracer = trace.getTracer("ii-tonya");
let shutdownHandler: () => Promise<void> = async () => undefined;

export function registerTelemetryShutdown(handler: () => Promise<void>): void {
  shutdownHandler = handler;
}

export async function shutdownTelemetry(): Promise<void> {
  await shutdownHandler();
}

export function sanitizeTraceException(_error: unknown): Exception {
  // OTel exporters receive this object verbatim. Never project arbitrary Error
  // fields: even a non-secret free-text message is untrusted telemetry.
  return { name: "ClientConversationError", message: "operation_failed" };
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
