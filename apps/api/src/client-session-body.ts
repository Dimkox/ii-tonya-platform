interface ClientSessionBodyInput {
  readonly body: Buffer;
  readonly contentType: string | undefined;
  readonly contentEncoding?: string;
  readonly contentLength?: string;
  readonly transferEncoding?: string;
}

const mediaTypePattern = /^application\/json(?:;\s*charset=utf-8)?$/iu;
const exactObjectPattern =
  /^\s*\{\s*("(?:\\[\s\S]|[^"\\])*")\s*:\s*("(?:\\[\s\S]|[^"\\])*")\s*\}\s*$/u;
const forbiddenProofCodePoint =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

export const parseClientSessionBody = (
  input: ClientSessionBodyInput,
): { readonly identityProof: string } | null => {
  if (
    !Buffer.isBuffer(input.body) ||
    input.body.byteLength > 8 * 1024 ||
    input.contentType === undefined ||
    !mediaTypePattern.test(input.contentType) ||
    input.contentEncoding !== undefined ||
    (input.contentLength !== undefined && input.transferEncoding !== undefined)
  ) {
    return null;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.body);
  } catch {
    return null;
  }
  const match = exactObjectPattern.exec(text);
  if (match === null) return null;

  let key: unknown;
  let identityProof: unknown;
  try {
    key = JSON.parse(match[1]!);
    identityProof = JSON.parse(match[2]!);
  } catch {
    return null;
  }
  if (
    key !== "identityProof" ||
    typeof identityProof !== "string" ||
    Buffer.byteLength(identityProof, "utf8") < 32 ||
    Buffer.byteLength(identityProof, "utf8") > 6_144 ||
    forbiddenProofCodePoint.test(identityProof) ||
    hasUnpairedSurrogate(identityProof)
  ) {
    return null;
  }
  return { identityProof };
};
