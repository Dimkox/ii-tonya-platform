import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { createSecurityEvent } from "./security-event.js";
it("serializes only bounded reasons and keyed fingerprints, never raw markers", async () => {
  const marker = "SECRET_UA_TOKEN_PERSONAL";
  const event = createSecurityEvent(Buffer.alloc(32, 1));
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += String(chunk);
  });
  const logger = createLogger(output);
  logger.warn({
    ...event("authentication_rejected", "::ffff:192.0.2.1", marker),
    headers: { authorization: marker },
    error: marker,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const logged = JSON.parse(text);
  expect(logged).toMatchObject({
    event: "telegram_ingress_security",
    reason: "authentication_rejected",
    ipFingerprint: expect.stringMatching(/^h1:[0-9a-f]{64}$/),
    uaFingerprint: expect.stringMatching(/^h1:[0-9a-f]{64}$/),
  });
  expect(text).not.toContain(marker);
  expect(text).not.toContain("192.0.2.1");
  expect(event("rate_limited", "192.0.2.1", marker).ipFingerprint).toBe(
    logged.ipFingerprint,
  );
  expect(
    createSecurityEvent(Buffer.alloc(32, 2))(
      "rate_limited",
      "192.0.2.1",
      marker,
    ).ipFingerprint,
  ).not.toBe(logged.ipFingerprint);
  expect(
    event("rate_limited", "192.0.2.1", "a".repeat(512) + "SECRET")
      .uaFingerprint,
  ).toBe(event("rate_limited", "192.0.2.1", "a".repeat(512)).uaFingerprint);
  logger.warn({
    event: "telegram_ingress_security",
    reason: marker,
    ipFingerprint: marker,
    uaFingerprint: marker,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(text).not.toContain(marker);
});

it("normalizes IPv6 and isolates injected key storage", () => {
  const key = Buffer.alloc(32, 7);
  const event = createSecurityEvent(key);
  const first = event("rate_limited", "2001:0DB8:0:0:0:0:0:1", undefined);
  key.fill(0);
  expect(event("rate_limited", "2001:db8::1", undefined)).toEqual(first);
  expect(() => createSecurityEvent(Buffer.alloc(1))).toThrow(
    "security_fingerprint_key_invalid",
  );
});
