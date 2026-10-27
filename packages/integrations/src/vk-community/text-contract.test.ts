import { expect, it, vi } from "vitest";
import {
  buildVkCommunityTextRequest,
  parseVkCommunityTextResponse,
  VkCommunityContractError,
} from "./text-contract.js";
const input = {
  accessToken: "synthetic_token&not_a_credential",
  peerId: "2000000001",
  randomId: "9223372036854775807",
  text: "Synthetic text",
};
it("builds only the documented fixed-origin URLencoded VK text request without I/O", () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("unexpected_network"));
  try {
    const request = buildVkCommunityTextRequest(input);
    expect(request.url).toBe("https://api.vk.com/method/messages.send");
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.headers).toEqual({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      access_token: input.accessToken,
      v: "5.199",
      peer_id: input.peerId,
      random_id: input.randomId,
      message: input.text,
    });
    expect(new URL(request.url).search).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
  } finally {
    fetcher.mockRestore();
  }
});
it.each([
  { peerId: "9223372036854775808" },
  { randomId: "-9223372036854775809" },
  { peerId: "01" },
  { peerId: "1\n" },
  { peerId: 123 },
  { text: "x".repeat(9001) },
  { text: "\ud800" },
  { text: "" },
  { accessToken: "synthetic\r\nheader" },
  { accessToken: "" },
  { url: "https://synthetic.invalid" },
])(
  "rejects unsafe or extraneous request input without echoing secrets%j",
  (change) => {
    expect(() =>
      buildVkCommunityTextRequest({ ...input, ...change } as never),
    ).toThrow(VkCommunityContractError);
    expect(() =>
      buildVkCommunityTextRequest({ ...input, ...change } as never),
    ).toThrow(/^vk_community_contract_invalid$/u);
  },
);
it("preserves exact signed int64 decimal values without Number coercion", () => {
  const request = buildVkCommunityTextRequest({
    ...input,
    peerId: "-9223372036854775808",
    randomId: "9223372036854775807",
    text: "x".repeat(9000),
  });
  const body = new URLSearchParams(request.body);
  expect(body.get("peer_id")).toBe("-9223372036854775808");
  expect(body.get("random_id")).toBe("9223372036854775807");
});

it("normalizes only the documented single integer response without inferring a peer or delivery", () => {
  expect(parseVkCommunityTextResponse({ response: 12345 })).toEqual({
    kind: "untrusted_ack",
    messageId: "12345",
  });
  expect(parseVkCommunityTextResponse({ response: 0 })).toEqual({
    kind: "untrusted_ack",
    messageId: "0",
  });
});
it.each([
  { response: [{ peer_id: 123, message_id: 9 }] },
  { response: 9007199254740992 },
  { response: "123" },
  { response: 1.5 },
  { response: -1 },
  { response: 1, error: {} },
  null,
  "synthetic_private_raw_error",
])(
  "rejects unsafe/unsupported response shapes without leaking them%j",
  (value) => {
    expect(parseVkCommunityTextResponse(value)).toEqual({
      kind: "unsupported_response",
    });
  },
);
it("returns a bounded provider error classification without echoing provider prose or tokens", () => {
  expect(
    parseVkCommunityTextResponse({
      error: { error_code: 5, error_msg: "synthetic_private_token" },
    }),
  ).toEqual({ kind: "provider_error" });
});
