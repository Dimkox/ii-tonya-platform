import Fastify, { type FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { effectivePeerAddress } from "./yookassa-peer.js";
import { yookassaWebhookRoutes } from "./routes/yookassa-webhook.js";

const provider = "185.71.76.4";
function request(
  remoteAddress: string | undefined = "127.0.0.1",
  rawHeaders: unknown[] = ["X-Real-IP", provider],
  header: unknown = provider,
): FastifyRequest {
  return {
    raw: { socket: { remoteAddress }, rawHeaders },
    headers: { "x-real-ip": header },
    ip: provider,
    ips: [provider],
  } as unknown as FastifyRequest;
}

describe("effective YooKassa peer", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:FFFF:7f00:1"])(
    "trusts only the specified local proxy: %s",
    (socket) => {
      expect(effectivePeerAddress(request(socket))).toBe(provider);
    },
  );
  it.each([
    "203.0.113.1",
    provider,
    "127.0.0.2",
    "127.1",
    "::ffff:127.0.0.2",
    "::",
    "::1%lo",
    " 127.0.0.1",
    "localhost",
    "",
  ])("rejects socket %s despite forged request.ip/ips", (socket) => {
    expect(effectivePeerAddress(request(socket))).toBe("");
  });
  it("rejects an absent socket address", () => {
    const value = request();
    Object.defineProperty(value.raw.socket, "remoteAddress", {
      value: undefined,
    });
    expect(effectivePeerAddress(value)).toBe("");
  });
  it.each([
    [provider, provider],
    ["2A02:5180:0:0:0:0:0:1", "2a02:5180::1"],
    ["::FFFF:185.71.76.4", provider],
    ["0:0:0:0:0:ffff:b947:4c04", provider],
    ["2001:db8::1", "2001:db8::1"],
  ])("normalizes %s", (input, expected) => {
    expect(
      effectivePeerAddress(request("::1", ["x-ReAl-iP", input], input)),
    ).toBe(expected);
  });
  it.each([
    "",
    "185.71.76.04",
    "185.71.76",
    "0xb9.71.76.4",
    "185.71.76.256",
    " 185.71.76.4",
    "185.71.76.4 ",
    "185.71.76.4\t",
    "185.71.76.4,203.0.113.1",
    "185.71.76.4:443",
    "[2a02:5180::1]:443",
    "[2a02:5180::1]",
    "2a02:5180::1%eth0",
    "garbage",
  ])("rejects invalid header %j", (value) => {
    expect(
      effectivePeerAddress(request("::1", ["X-Real-IP", value], value)),
    ).toBe("");
  });
  it.each([
    [],
    ["X-Real-IP"],
    ["X-Real-IP", provider, "dangling"],
    ["X-Real-IP", provider, "x-real-ip", provider],
    ["X-Real-IP", provider, "X-REAL-IP", "203.0.113.1"],
    ["X-Real-IP", [provider]],
    [4, "value", "X-Real-IP", provider],
    ["other", null, "X-Real-IP", provider],
  ])("rejects missing/duplicate/malformed raw headers %#", (...raw) => {
    expect(effectivePeerAddress(request("::1", raw))).toBe("");
  });
  it("rejects a normalized array even with one raw occurrence", () => {
    expect(
      effectivePeerAddress(request("::1", ["X-Real-IP", provider], [provider])),
    ).toBe("");
  });
  it("ignores unrelated forwarding headers", () => {
    expect(
      effectivePeerAddress(
        request("::1", [
          "Forwarded",
          "for=evil",
          "X-Forwarded-For",
          "evil",
          "X-Real-IP",
          provider,
        ]),
      ),
    ).toBe(provider);
  });
});

describe("real webhook route with trusted peer helper", () => {
  it.each([
    { socket: "203.0.113.1", ip: provider, status: 403 },
    { socket: "127.0.0.2", ip: provider, status: 403 },
    { socket: "127.0.0.1", ip: "203.0.113.1", status: 403 },
    { socket: "127.0.0.1", ip: "185.71.76.04", status: 403 },
    { socket: "127.0.0.1", ip: [provider, provider], status: 403 },
    { socket: "127.0.0.1", ip: provider, status: 503 },
    { socket: "::1", ip: "2A02:5180::1", status: 503 },
    { socket: "::ffff:127.0.0.1", ip: "::ffff:b947:4c04", status: 503 },
  ])("admission %#", async ({ socket, ip, status }) => {
    const calls: string[] = [];
    const app = Fastify();
    await app.register(yookassaWebhookRoutes, {
      effectivePeerAddress,
      inbox: {
        async claim() {
          calls.push("claim");
          return { kind: "claimed", claimId: "local" };
        },
        async complete() {
          calls.push("complete");
        },
        async fail() {
          calls.push("fail");
        },
      },
      async verify() {
        // A trusted peer does not establish ownership of this terminal event.
        calls.push("verify");
        return null;
      },
      async deliver() {
        calls.push("deliver");
      },
      async resolveSucceeded() {
        calls.push("resolve");
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/webhooks/yookassa",
        remoteAddress: socket,
        headers: {
          "x-real-ip": ip,
          "x-forwarded-for": provider,
          forwarded: `for=${provider}`,
        },
        payload: {
          type: "notification",
          event: "payment.succeeded",
          object: { id: "2f4b6d0d-000f-5000-9000-000000000601" },
        },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual(
        status === 403
          ? { error: "request_rejected" }
          : { error: "delivery_pending" },
      );
      expect(calls).toEqual(status === 403 ? [] : ["claim", "verify", "fail"]);
    } finally {
      await app.close();
    }
  });
});
