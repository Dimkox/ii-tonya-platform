interface BookingBodyInput {
  readonly body: Buffer;
  readonly contentType?: string;
  readonly contentEncoding?: string;
  readonly contentLength?: string;
  readonly transferEncoding?: string;
}

const MEDIA_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/iu;
const EXACT_OBJECT =
  /^\s*\{\s*("(?:\\[\s\S]|[^"\\])*")\s*:\s*("(?:\\[\s\S]|[^"\\])*")\s*\}\s*$/u;
const CHOICE_HANDLE = /^ch1\.[A-Za-z0-9_-]{43}$/u;

export const parseClientBookingBody = (
  input: BookingBodyInput,
): { readonly choiceHandle: `ch1.${string}` } | null => {
  if (
    !Buffer.isBuffer(input.body) ||
    input.body.byteLength > 1_024 ||
    input.contentType === undefined ||
    !MEDIA_TYPE.test(input.contentType) ||
    input.contentEncoding !== undefined ||
    input.transferEncoding !== undefined ||
    (input.contentLength !== undefined &&
      (!/^(?:0|[1-9]\d*)$/u.test(input.contentLength) ||
        Number(input.contentLength) !== input.body.byteLength))
  ) {
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.body);
  } catch {
    return null;
  }
  const match = EXACT_OBJECT.exec(text);
  if (match === null) return null;
  try {
    const key = JSON.parse(match[1]!);
    const choiceHandle = JSON.parse(match[2]!);
    return key === "choiceHandle" &&
      typeof choiceHandle === "string" &&
      CHOICE_HANDLE.test(choiceHandle)
      ? { choiceHandle: choiceHandle as `ch1.${string}` }
      : null;
  } catch {
    return null;
  }
};
