import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace,
  SpanStatusCode,
  createTraceState,
  createContextKey,
} from "@opentelemetry/api";
import { node, tracing } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const exporter = new tracing.InMemorySpanExporter();
const provider = new node.NodeTracerProvider({
  spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
});
let traced: typeof import("./tracing.js").traced;
beforeAll(async () => {
  trace.disable();
  context.disable();
  provider.register();
  ({ traced } = await import("./tracing.js"));
});
afterAll(async () => {
  trace.disable();
  context.disable();
  await provider.shutdown();
});

it("does not export caller tracestate even when the callback succeeds unchanged", async () => {
  exporter.reset();
  const inherited = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: "1234567890abcdef1234567890abcdef",
    spanId: "1234567890abcdef",
    traceFlags: 1,
    traceState: createTraceState(
      "private=ordinary_private_appointment_details",
    ),
  });
  await expect(
    context.with(inherited, () => traced("selarti.inbound", async () => 9)),
  ).resolves.toBe(9);
  expect(exporter.getFinishedSpans()).toHaveLength(1);
  expect(
    exporter.getFinishedSpans()[0]?.spanContext().traceState,
  ).toBeUndefined();
  expect(
    exporter.getFinishedSpans()[0]?.parentSpanContext?.traceState,
  ).toBeUndefined();
});

it("strips inherited tracestate/baggage while keeping parent-child context through non-recording spans", async () => {
  exporter.reset();
  const canary = "ordinary_private_appointment_details";
  const parent = {
    traceId: "1234567890abcdef1234567890abcdef",
    spanId: "1234567890abcdef",
    traceFlags: 1,
    isRemote: true,
    traceState: createTraceState(`private=${canary}`),
  };
  const privateKey = createContextKey("private-context");
  const inherited = propagation.setBaggage(
    trace.setSpanContext(ROOT_CONTEXT, parent).setValue(privateKey, canary),
    propagation.createBaggage({ private: { value: canary } }),
  );
  const result = { business: canary };
  await expect(
    context.with(inherited, () =>
      traced("selarti.inbound", async () => {
        const outer = trace.getSpan(context.active());
        expect(outer?.isRecording()).toBe(false);
        expect(outer?.spanContext().traceState).toBeUndefined();
        expect(propagation.getBaggage(context.active())).toBeUndefined();
        expect(context.active().getValue(privateKey)).toBeUndefined();
        outer?.setAttribute("private", canary);
        outer?.addEvent(canary);
        await Promise.resolve();
        expect(trace.getSpan(context.active())?.spanContext().spanId).toBe(
          outer?.spanContext().spanId,
        );
        return traced(canary, async () => {
          expect(trace.getSpan(context.active())?.isRecording()).toBe(false);
          expect(
            trace.getSpan(context.active())?.spanContext().spanId,
          ).not.toBe(outer?.spanContext().spanId);
          expect(propagation.getBaggage(context.active())).toBeUndefined();
          return result;
        });
      }),
    ),
  ).resolves.toBe(result);
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(2);
  const [inner, outer] = spans;
  expect(outer?.parentSpanContext?.spanId).toBe(parent.spanId);
  expect(inner?.parentSpanContext?.spanId).toBe(outer?.spanContext().spanId);
  for (const span of spans) {
    expect(span.spanContext().traceId).toBe(parent.traceId);
    expect(span.spanContext().traceState).toBeUndefined();
    expect(span.parentSpanContext?.traceState).toBeUndefined();
    expect(span.attributes).toEqual({});
    expect(span.events).toEqual([]);
    expect(span.status).toEqual({ code: SpanStatusCode.OK });
    expect(
      JSON.stringify({
        name: span.name,
        context: span.spanContext(),
        parent: span.parentSpanContext,
        attributes: span.attributes,
        events: span.events,
      }),
    ).not.toContain(canary);
  }
  expect(spans.map((span) => span.name)).toEqual([
    "operation",
    "selarti.inbound",
  ]);
});

it.each([
  ["ordinary_private_trace", "1234567890abcdef"],
  ["1234567890abcdef1234567890abcdef", "ordinary_private_span"],
  ["00000000000000000000000000000000", "1234567890abcdef"],
  ["1234567890abcdef1234567890abcdef", "0000000000000000"],
])("rejects non-W3C parent identifiers (%s, %s)", async (traceId, spanId) => {
  exporter.reset();
  const inherited = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: 1,
  });
  await expect(
    context.with(inherited, () => traced("selarti.inbound", async () => 7)),
  ).resolves.toBe(7);
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]?.parentSpanContext).toBeUndefined();
  expect(spans[0]?.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/u);
});

it("does not evaluate inherited tracestate or baggage canary accessors", async () => {
  exporter.reset();
  const invoked = vi.fn(() => {
    throw new Error("private accessor");
  });
  const inherited = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: "1234567890abcdef1234567890abcdef",
    spanId: "1234567890abcdef",
    traceFlags: 1,
    get traceState() {
      return invoked();
    },
  });
  await expect(
    context.with(inherited, () => traced("selarti.inbound", async () => 8)),
  ).resolves.toBe(8);
  expect(invoked).not.toHaveBeenCalled();
  expect(exporter.getFinishedSpans()).toHaveLength(1);
});

it("runs the callback exactly once if startSpan throws, preserving success and exact rejection", async () => {
  const start = vi
    .spyOn(provider.getTracer("ii-tonya"), "startSpan")
    .mockImplementation(() => {
      throw new Error("private creation failure");
    });
  const value = { business: "private value" };
  const error = new Error("private failure");
  const success = vi.fn(async () => value);
  const failure = vi.fn(async () => {
    throw error;
  });
  try {
    await expect(traced("selarti.inbound", success)).resolves.toBe(value);
    await expect(traced("selarti.inbound", failure)).rejects.toBe(error);
    expect(success).toHaveBeenCalledExactlyOnceWith();
    expect(failure).toHaveBeenCalledExactlyOnceWith();
    expect(start).toHaveBeenCalledTimes(2);
  } finally {
    start.mockRestore();
  }
});

it("records real ended spans with fixed names and status, and exposes no raw Span", async () => {
  exporter.reset();
  const callback = vi.fn(async (...args: unknown[]) => {
    expect(args).toEqual([]);
    return "business result";
  });
  await expect(traced("selarti.inbound", callback)).resolves.toBe(
    "business result",
  );
  await expect(
    traced("ordinary private appointment details", callback),
  ).resolves.toBe("business result");
  const spans = exporter.getFinishedSpans();
  expect(spans.map((span) => span.name)).toEqual([
    "selarti.inbound",
    "operation",
  ]);
  for (const span of spans) {
    expect(span.ended).toBe(true);
    expect(span.status).toEqual({ code: SpanStatusCode.OK });
    expect(span.attributes).toEqual({});
    expect(span.events).toEqual([]);
  }
});

it.each(["ECONNREFUSED", "private-code"])(
  "rethrows the exact error without exporting prose/name/stack/cause (%s)",
  async (code) => {
    exporter.reset();
    const error = Object.assign(
      new Error("private prose", { cause: "private cause" }),
      { name: "private name", stack: "private stack", code },
    );
    await expect(
      traced("selarti.inbound", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.ended).toBe(true);
    expect(spans[0]?.events).toEqual([]);
    expect(spans[0]?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(spans[0]?.attributes).toEqual({
      "failure.class":
        code === "ECONNREFUSED" ? "connection_refused" : "internal_error",
    });
  },
);

it("does not let span recording failures replace a business result or failure", async () => {
  const error = new Error("business failure");
  const tracer = provider.getTracer("ii-tonya");
  const original = tracer.startSpan.bind(tracer);
  const end = vi.fn();
  const start = vi.spyOn(tracer, "startSpan").mockImplementation((...args) => {
    const span = original(...args);
    const realEnd = span.end.bind(span);
    span.setStatus = () => {
      throw new Error("recording failed");
    };
    span.setAttribute = () => {
      throw new Error("recording failed");
    };
    span.end = (...endArgs) => {
      end();
      realEnd(...endArgs);
      throw new Error("end failed");
    };
    return span;
  });
  try {
    await expect(
      traced("selarti.inbound", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    await expect(traced("selarti.inbound", async () => 7)).resolves.toBe(7);
    expect(end).toHaveBeenCalledTimes(2);
  } finally {
    start.mockRestore();
  }
});
