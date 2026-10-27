import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  isValidTraceId,
  isValidSpanId,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { classifyFailure, ownData } from "./telemetry-schema.js";

const tracer = trace.getTracer("ii-tonya");
let shutdownHandler: () => Promise<void> = async () => undefined;

export function registerTelemetryShutdown(handler: () => Promise<void>): void {
  shutdownHandler = handler;
}

export async function shutdownTelemetry(): Promise<void> {
  await shutdownHandler();
}

const recordSafely = (record: () => void): void => {
  try {
    record();
  } catch {
    /* Telemetry must not replace a business result/error. */
  }
};

function protocolContext(value: unknown): Context {
  const traceId = ownData(value, "traceId");
  const spanId = ownData(value, "spanId");
  const flags = ownData(value, "traceFlags");
  if (
    typeof traceId !== "string" ||
    !isValidTraceId(traceId) ||
    typeof spanId !== "string" ||
    !isValidSpanId(spanId)
  )
    return ROOT_CONTEXT;
  // Start from ROOT, not active(): baggage, tracestate and arbitrary context
  // entries must not reach processors/exporters or the business callback.
  // setSpanContext installs a NON-recording span; never expose the real Span.
  return trace.setSpanContext(
    ROOT_CONTEXT,
    Object.freeze({
      traceId,
      spanId,
      traceFlags:
        typeof flags === "number" &&
        Number.isInteger(flags) &&
        flags >= 0 &&
        flags <= 255
          ? flags & 1
          : 0,
      isRemote: ownData(value, "isRemote") === true,
    }),
  );
}

export async function traced<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  let operationContext = ROOT_CONTEXT;
  let span: Span | undefined;
  try {
    operationContext = protocolContext(trace.getSpanContext(context.active()));
    span = tracer.startSpan(
      name === "selarti.inbound" ? name : "operation",
      {},
      operationContext,
    );
    operationContext = protocolContext(span.spanContext());
  } catch {
    /* Even creation failure leaves one invocation under safe context. */
  }
  try {
    const result = await context.with(operationContext, operation);
    recordSafely(() => span?.setStatus({ code: SpanStatusCode.OK }));
    return result;
  } catch (error) {
    recordSafely(() => span?.setStatus({ code: SpanStatusCode.ERROR }));
    recordSafely(() =>
      span?.setAttribute("failure.class", classifyFailure(error)),
    );
    throw error;
  } finally {
    recordSafely(() => span?.end());
  }
}
