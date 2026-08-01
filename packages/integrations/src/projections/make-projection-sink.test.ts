import { describe, expect, it, vi } from "vitest";
import {
  MakeProjectionPermanentFailure,
  MakeProjectionRetryableFailure,
  MakeProjectionSink,
} from "./make-projection-sink.js";

const event = {
  eventId: "019fa875-2d67-78f1-8c71-f4936268da29",
  topic: "reservation_projection.v1" as const,
  occurredAt: "2026-07-28T10:00:00.000Z",
  correlationId: "corr-1",
  schemaVersion: 1 as const,
  data: {
    reservationId: "r-1",
    status: "reserved",
    expertId: "e-1",
  },
};

describe("Make projection sink", () => {
  it("sends a versioned idempotent projection with no sensitive fields", async () => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });

    await sink.publish(event);

    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: new URL("https://projection.invalid/events"),
      headers: expect.objectContaining({
        Authorization: "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
        "Idempotency-Key": "019fa875-2d67-78f1-8c71-f4936268da29",
      }),
      body: event,
      signal: expect.any(AbortSignal),
    }));
    expect(post.mock.calls[0]?.[0].signal.aborted).toBe(false);
    expect(JSON.stringify(post.mock.calls[0])).not.toContain("rawConversation");
  });

  it("uses an HTTPS endpoint and a five second abort signal", async () => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });

    await sink.publish(event);

    expect(post.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
    expect(() => new MakeProjectionSink({
      endpoint: new URL("http://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    })).toThrow("make_projection_https_required");
  });

  it("rejects projection data outside the topic allowlist", async () => {
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post: vi.fn().mockResolvedValue({ status: 202 }),
    });

    await expect(sink.publish({
      ...event,
      data: { ...event.data, rawConversation: "never export" },
    })).rejects.toThrow("invalid_projection_data");
  });

  it("normalizes retryable and permanent delivery failures", async () => {
    const retryable = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post: vi.fn().mockResolvedValue({ status: 503 }),
    });
    const permanent = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post: vi.fn().mockResolvedValue({ status: 400 }),
    });

    await expect(retryable.publish(event)).rejects.toBeInstanceOf(
      MakeProjectionRetryableFailure,
    );
    await expect(permanent.publish(event)).rejects.toBeInstanceOf(
      MakeProjectionPermanentFailure,
    );
  });

  it.each([
    ["nested object", { ...event.data, status: { value: "reserved" } }],
    ["array", { ...event.data, status: ["reserved"] }],
    ["undefined", { ...event.data, status: undefined }],
  ])("rejects non-scalar projection data: %s", async (_label, data) => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });

    await expect(sink.publish({ ...event, data } as never)).rejects.toBeInstanceOf(
      MakeProjectionPermanentFailure,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects non-finite numbers and inherited topic names", async () => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });

    await expect(sink.publish({
      ...event,
      topic: "package_balance_projection.v1",
      data: { userId: "u-1", packageId: "p-1", ledgerDerivedBalance: Number.NaN },
    } as never)).rejects.toBeInstanceOf(MakeProjectionPermanentFailure);
    await expect(sink.publish({ ...event, topic: "toString", data: {} } as never)).rejects.toBeInstanceOf(
      MakeProjectionPermanentFailure,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ["event id", { ...event, eventId: 7 }],
    ["occurred at", { ...event, occurredAt: null }],
    ["correlation id", { ...event, correlationId: {} }],
    ["schema version", { ...event, schemaVersion: "1" }],
  ])("rejects an invalid %s envelope field", async (_label, invalidEvent) => {
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });

    await expect(sink.publish(invalidEvent as never)).rejects.toBeInstanceOf(
      MakeProjectionPermanentFailure,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("retains a private HTTPS endpoint after the injected URL is mutated", async () => {
    const endpoint = new URL("https://projection.invalid/events");
    const post = vi.fn().mockResolvedValue({ status: 202 });
    const sink = new MakeProjectionSink({
      endpoint,
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post,
    });
    endpoint.protocol = "http:";

    await sink.publish(event);

    expect(post.mock.calls[0]?.[0].endpoint.href).toBe("https://projection.invalid/events");
  });

  it("classifies malformed transport results and authorization failures as permanent", async () => {
    const malformed = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => "Bearer __PLACEHOLDER_MAKE_PROJECTION_TOKEN__",
      post: vi.fn().mockResolvedValue(null),
    });
    const authorizationFailure = new MakeProjectionSink({
      endpoint: new URL("https://projection.invalid/events"),
      authorization: () => {
        throw new Error("__PLACEHOLDER_MAKE_PROJECTION_TOKEN__");
      },
      post: vi.fn(),
    });

    await expect(malformed.publish(event)).rejects.toBeInstanceOf(
      MakeProjectionPermanentFailure,
    );
    await expect(authorizationFailure.publish(event)).rejects.toMatchObject({
      name: "MakeProjectionPermanentFailure",
      reasonCode: "invalid_projection_authorization",
    });
  });
});
