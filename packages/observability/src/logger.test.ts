import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

describe("logger redaction", () => {
  it("removes credentials, raw bodies, profile text, and meeting links", async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    createLogger(output).info({
      authorization: "Bearer __PLACEHOLDER_TEST_AUTH_TOKEN__",
      rawBody: "private message",
      clientProfile: { goals: "private" },
      meetingUrl: "https://meeting.invalid/private",
      providerUrl: "https://api.telegram.org/bot__PLACEHOLDER_TELEGRAM_BOT_TOKEN__/sendMessage",
      correlationId: "corr-1",
    }, "request");
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    expect(line).not.toContain("__PLACEHOLDER_TEST_AUTH_TOKEN__");
    expect(line).not.toContain("private message");
    expect(line).not.toContain("meeting.invalid");
    expect(line).not.toContain("__PLACEHOLDER_TELEGRAM_BOT_TOKEN__");
    expect(line).toContain("/bot[REDACTED]/sendMessage");
    expect(line).toContain("corr-1");
  });

  it("recursively sanitizes nested provider, conversation, contact, URL, and token fields", async () => {
    const output = new PassThrough(); const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    createLogger(output).info({ envelope: { providerPayload: { nested: { token: "nested-secret", text: "private conversation", contact: { email: "private@example.invalid" }, url: "https://private.invalid" } }, safe: { correlationId: "corr-nested", providerUrl: "https://api.telegram.org/botVERY_SECRET/sendMessage" } } });
    await new Promise((resolve) => output.once("data", resolve));
    const line = Buffer.concat(chunks).toString("utf8");
    for (const secret of ["nested-secret", "private conversation", "private@example.invalid", "https://private.invalid", "VERY_SECRET"]) expect(line).not.toContain(secret);
    expect(line).toContain("corr-nested");
    expect(line).toContain("/bot[REDACTED]/sendMessage");
  });
});
