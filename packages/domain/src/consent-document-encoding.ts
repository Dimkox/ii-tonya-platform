/**
 * Deployment gate for consent document text.
 *
 * PowerShell's default code page replaces Cyrillic with literal "?" before the
 * string reaches PostgreSQL. The stored v1 row stays immutable; this check
 * refuses to publish or present a substitute. It does not approve new legal copy.
 */
export type ConsentEncodingIssue =
  | "empty"
  | "bom"
  | "replacement_character"
  | "control_character"
  | "question_mark_substitution"
  | "utf16"
  | "invalid_utf8";

const QUESTION = /\?/g;
const LETTER = /\p{L}/gu;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

export function consentTextEncodingIssue(
  text: string,
): ConsentEncodingIssue | null {
  if (text.length === 0) return "empty";
  if (text.charCodeAt(0) === 0xfeff) return "bom";
  if (text.includes("\uFFFD")) return "replacement_character";
  if (CONTROL.test(text)) return "control_character";
  const questions = text.match(QUESTION)?.length ?? 0;
  const letters = text.match(LETTER)?.length ?? 0;
  if (!letters && questions > 0) return "question_mark_substitution";
  // Observed production row: 529 literal "?" inside 750 characters.
  if (text.length >= 80 && questions / text.length >= 0.4)
    return "question_mark_substitution";
  if (questions >= 24 && questions > letters)
    return "question_mark_substitution";
  return null;
}

export function consentDocumentPublishable(
  title: string,
  body: string,
): boolean {
  return (
    consentTextEncodingIssue(title) === null &&
    consentTextEncodingIssue(body) === null
  );
}

/** Read a deployment file as bytes. Rejects UTF-16 and invalid UTF-8. Strips a UTF-8 BOM. */
export function decodeConsentDeploymentUtf8(
  bytes: Uint8Array,
): { text: string } | { issue: ConsentEncodingIssue } {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff))
  )
    return { issue: "utf16" };
  const view =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(view);
    const issue = consentTextEncodingIssue(text);
    return issue ? { issue } : { text };
  } catch {
    return { issue: "invalid_utf8" };
  }
}
