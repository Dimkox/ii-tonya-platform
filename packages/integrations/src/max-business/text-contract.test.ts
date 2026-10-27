import { expect, it, vi } from "vitest";
import {
  buildMaxBusinessTextRequest,
  parseMaxBusinessTextResponse,
  MaxBusinessContractError,
} from "./text-contract.js";
const input = {
  accessToken: "synthetic_opaque_token",
  target: { userId: "9223372036854775807" },
  text: "Synthetic text",
};
const response = () => ({
  message: {
    recipient: { chat_type: "dialog", user_id: 123, chat_id: null },
    body: {
      mid: "mid.synthetic",
      seq: 42,
      text: "Synthetic text",
      attachments: null,
      markup: null,
    },
    timestamp: 1792753200000,
  },
});
it("builds fixed current-host MAX JSON text with a query target and header token only", () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected_network"));
  try {
    const request = buildMaxBusinessTextRequest(input);
    expect(request.url).toBe(
      "https://platform-api2.max.ru/messages?user_id=9223372036854775807",
    );
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.headers).toEqual({
      "content-type": "application/json",
      Authorization: input.accessToken,
    });
    expect(JSON.parse(request.body)).toEqual({ text: input.text });
    expect(new URL(request.url).searchParams.has("access_token")).toBe(false);
    expect(new URL(request.url).searchParams.has("token")).toBe(false);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
it("preserves exact signed int64 chat targets and 4000-character text without Number coercion", () => {
  const request = buildMaxBusinessTextRequest({
    ...input,
    target: { chatId: "-9223372036854775808" },
    text: "x".repeat(4000),
  });
  expect(new URL(request.url).search).toBe("?chat_id=-9223372036854775808");
});
it.each([
  { target: { userId: "1", chatId: "2" } },
  { target: {} },
  { target: { userId: "01" } },
  { target: { userId: 123 } },
  { target: { userId: "9223372036854775808" } },
  { target: { chatId: "-9223372036854775809" } },
  { text: "x".repeat(4001) },
  { text: "\ud800" },
  { text: "" },
  { accessToken: "bad\nheader" },
  { accessToken: "" },
  { url: "https://platform-api.max.ru/messages" },
])(
  "rejects unsafe or extra request inputs without echoing them%j",
  (change) => {
    expect(() =>
      buildMaxBusinessTextRequest({ ...input, ...change } as never),
    ).toThrow(MaxBusinessContractError);
    expect(() =>
      buildMaxBusinessTextRequest({ ...input, ...change } as never),
    ).toThrow(/^max_business_contract_invalid$/u);
  },
);
it("parses documented Message fields only as untrusted contract data", () => {
  expect(parseMaxBusinessTextResponse(response())).toEqual({
    kind: "untrusted_ack",
    messageId: "mid.synthetic",
    sequence: "42",
    timestamp: "1792753200000",
    recipient: { chatType: "dialog", userId: "123" },
  });
});
it("does not manufacture an absent recipient identity", () => {
  const value = response();
  value.message.recipient = { chat_type: "dialog" } as never;
  expect(parseMaxBusinessTextResponse(value)).toEqual({
    kind: "untrusted_ack",
    messageId: "mid.synthetic",
    sequence: "42",
    timestamp: "1792753200000",
    recipient: { chatType: "dialog" },
  });
});
it.each([
  { message: null },
  { message: { body: { mid: "x", seq: 1 }, timestamp: 1 } },
  {
    message: {
      recipient: { chat_type: "dialog" },
      body: { mid: "x" },
      timestamp: 1,
    },
  },
  {
    message: {
      recipient: { chat_type: "dialog" },
      body: { mid: "x", seq: 9007199254740992 },
      timestamp: 1,
    },
  },
  {
    message: {
      recipient: { chat_type: "dialog", user_id: 9007199254740992 },
      body: { mid: "x", seq: 1 },
      timestamp: 1,
    },
  },
  {
    message: {
      recipient: { chat_type: "dialog" },
      body: { mid: "x", seq: 1 },
      timestamp: 9007199254740992,
    },
  },
  {
    message: {
      recipient: { chat_type: "dialog" },
      body: { mid: "x", seq: "42" },
      timestamp: 1,
    },
  },
  { code: "access.denied", message: "synthetic_private_provider_error" },
  null,
  "synthetic_private_raw_body",
])(
  "fails closed for unknown/error/malformed or precision-lost response%j",
  (value) => {
    expect(parseMaxBusinessTextResponse(value)).toEqual({
      kind: "unsupported_response",
    });
  },
);
