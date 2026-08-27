import { describe, expect, it } from "vitest";

import { parseClientSessionBody } from "./client-session-body.js";

const proof = "P".repeat(32);
const parse = (body: string | Buffer, overrides: Record<string, unknown> = {}) =>
  parseClientSessionBody({
    body: typeof body === "string" ? Buffer.from(body, "utf8") : body,
    contentType: "application/json",
    ...overrides,
  } as never);

describe("strict client session issue body", () => {
  it.each(["application/json", "Application/JSON; Charset=UTF-8"])(
    "accepts only the frozen JSON media type: %s",
    (contentType) => {
      expect(parse(JSON.stringify({ identityProof: proof }), { contentType })).toEqual({
        identityProof: proof,
      });
    },
  );

  it.each([
    ["duplicate key", `{"identityProof":"${proof}","identityProof":"${proof}"}`, {}],
    ["escaped duplicate key", `{"identityProof":"${proof}","\\u0069dentityProof":"${proof}"}`, {}],
    ["extra key", JSON.stringify({ identityProof: proof, extra: true }), {}],
    ["trailing bytes", `${JSON.stringify({ identityProof: proof })}x`, {}],
    ["wrong media type", JSON.stringify({ identityProof: proof }), { contentType: "text/json" }],
    ["media parameter", JSON.stringify({ identityProof: proof }), { contentType: "application/json; profile=x" }],
    ["content encoding", JSON.stringify({ identityProof: proof }), { contentEncoding: "gzip" }],
    ["ambiguous framing", JSON.stringify({ identityProof: proof }), { contentLength: "64", transferEncoding: "chunked" }],
    ["short proof", JSON.stringify({ identityProof: "P".repeat(31) }), {}],
    ["long proof", JSON.stringify({ identityProof: "P".repeat(6_145) }), {}],
    ["control", JSON.stringify({ identityProof: `${"P".repeat(31)}\u007f` }), {}],
    ["line separator", JSON.stringify({ identityProof: `${"P".repeat(31)}\u2028` }), {}],
    ["lone surrogate", `{"identityProof":"${"P".repeat(31)}\\ud800"}`, {}],
  ])("rejects %s", (_name, body, overrides) => {
    expect(parse(body as string, overrides as Record<string, unknown>)).toBeNull();
  });

  it("rejects malformed UTF-8 and a de-framed entity above 8 KiB", () => {
    expect(parse(Buffer.from([0xc3, 0x28]))).toBeNull();
    expect(parse(Buffer.alloc(8 * 1024 + 1, 0x20))).toBeNull();
  });
});
