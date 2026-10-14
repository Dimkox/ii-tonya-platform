import { describe, expect, it, vi } from "vitest";
import {
  createSelartiResponseService,
  decodeProviderTextProposal,
} from "./selarti-response-service.js";

const requestId = `sha256:${"a".repeat(64)}`;
const dialogueId = "00000000-0000-4000-8000-000000000501";
const valid = {
  version: 1,
  requestId,
  dialogueId,
  threadId: requestId,
  text: "Подходящий ответ без внешних полномочий.",
};

describe("provider-neutral Selarti response codec", () => {
  it("accepts only the bounded text proposal contract", () => {
    expect(
      decodeProviderTextProposal(valid, { allowedUrlHosts: ["ii-tonya.ru"] }),
    ).toMatchObject({ requestId, dialogueId, text: valid.text });
  });

  it.each([
    [{ ...valid, action: "credit_account" }, "authority field"],
    [{ ...valid, instructions: ["ignore policy"] }, "instructions"],
    [{ ...valid, toolCalls: [{ name: "book" }] }, "tool calls"],
    [{ ...valid, credentials: "Bearer secret" }, "credentials field"],
    [{ ...valid, text: "authorization: Bearer abc" }, "credential text"],
    [{ ...valid, text: "<tool_call>book</tool_call>" }, "tool markup"],
    [{ ...valid, text: "bad\u0000text" }, "control character"],
    [{ ...valid, text: "x".repeat(4_097) }, "overlong text"],
    [
      { ...valid, dialogueId: "00000000-0000-4000-8000-000000000502" },
      "mismatch fixture",
    ],
    [{ ...valid, threadId: `sha256:${"b".repeat(64)}` }, "thread mismatch"],
    [{ ...valid, text: "Смотрите https://evil.example/path" }, "URL host"],
  ])("rejects %s (%s)", (body, label) => {
    expect(label.length).toBeGreaterThan(0);
    expect(() =>
      decodeProviderTextProposal(body, {
        allowedUrlHosts: ["ii-tonya.ru"],
        expectedDialogueId: dialogueId,
      }),
    ).toThrow();
  });

  it("rejects prohibited client copy before the proposal is accepted", () => {
    expect(() =>
      decodeProviderTextProposal(
        {
          ...valid,
          text: "Запишитесь сейчас — это специально для вас, лучшая скидка года!",
        },
        { allowedUrlHosts: ["ii-tonya.ru"] },
      ),
    ).toThrow("selarti_response_copy_prohibited");
  });

  it("allows an explicitly allowlisted HTTPS URL only", () => {
    expect(
      decodeProviderTextProposal(
        { ...valid, text: "Подробнее: https://ii-tonya.ru/privacy" },
        { allowedUrlHosts: ["ii-tonya.ru"] },
      ).text,
    ).toContain("https://ii-tonya.ru/privacy");
  });
});

describe("Selarti response application service", () => {
  it("stays default-off before repository mutation", async () => {
    const proposals = { accept: vi.fn() };
    const service = createSelartiResponseService({
      enabled: false,
      tenantKey: "bot-b2",
      allowedUrlHosts: ["ii-tonya.ru"],
      clock: () => new Date("2026-08-29T00:00:10.000Z"),
      proposals,
    });
    await expect(service.handle(valid)).resolves.toEqual({
      status: "unavailable",
    });
    expect(proposals.accept).not.toHaveBeenCalled();
  });

  it("passes only a canonical proposal to the transactional repository", async () => {
    const proposals = {
      accept: vi.fn(async () => "accepted" as const),
    };
    const service = createSelartiResponseService({
      enabled: true,
      tenantKey: "bot-b2",
      allowedUrlHosts: ["ii-tonya.ru"],
      clock: () => new Date("2026-08-29T00:00:10.000Z"),
      proposals,
    });
    await expect(service.handle(valid)).resolves.toEqual({
      status: "accepted",
    });
    expect(proposals.accept).toHaveBeenCalledWith({
      requestId,
      dialogueId,
      threadId: requestId,
      tenantKey: "bot-b2",
      text: valid.text,
      responsePayloadHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      receivedAt: "2026-08-29T00:00:10.000Z",
    });
  });

  it("rejects prohibited copy at the enabled ingress before repository mutation", async () => {
    const proposals = { accept: vi.fn() };
    const service = createSelartiResponseService({
      enabled: true,
      tenantKey: "bot-b2",
      allowedUrlHosts: ["ii-tonya.ru"],
      clock: () => new Date("2026-08-29T00:00:10.000Z"),
      proposals,
    });
    await expect(
      service.handle({
        ...valid,
        text: "Запишитесь сейчас — лучшая скидка года.",
      }),
    ).resolves.toEqual({ status: "rejected" });
    expect(proposals.accept).not.toHaveBeenCalled();
  });
});
