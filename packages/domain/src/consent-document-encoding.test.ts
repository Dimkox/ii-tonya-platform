import { describe, expect, it } from "vitest";
import {
  consentDocumentPublishable,
  decodeConsentDeploymentUtf8,
} from "./consent-document-encoding.js";

const russian =
  "Согласие на обработку персональных данных для информирования о проекте ии-Тоня. Отзыв доступен в этом чате.";

describe("consent deployment encoding", () => {
  it("keeps Russian UTF-8 text publishable", () => {
    expect(consentDocumentPublishable("Согласие", russian)).toBe(true);
    const bytes = new TextEncoder().encode(russian);
    expect(decodeConsentDeploymentUtf8(bytes)).toEqual({ text: russian });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    expect(decodeConsentDeploymentUtf8(bom)).toEqual({ text: russian });
  });

  it("rejects the PowerShell Cyrillic substitution of 529 question marks in 750 characters", () => {
    const corrupted = `${"?".repeat(529)}${"й".repeat(750 - 529)}`;
    expect(corrupted).toHaveLength(750);
    expect(consentDocumentPublishable("????", corrupted)).toBe(false);
    expect(
      decodeConsentDeploymentUtf8(new TextEncoder().encode(corrupted)),
    ).toEqual({
      issue: "question_mark_substitution",
    });
  });

  it("rejects UTF-16 and a Windows-1251 byte string instead of storing question marks", () => {
    expect(
      decodeConsentDeploymentUtf8(Uint8Array.from([0xff, 0xfe, 0x41, 0x00])),
    ).toEqual({ issue: "utf16" });
    // "Привет" in Windows-1251. Fatal UTF-8 decoding must not turn this into "?".
    expect(
      decodeConsentDeploymentUtf8(
        Uint8Array.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]),
      ),
    ).toEqual({ issue: "invalid_utf8" });
  });
});
