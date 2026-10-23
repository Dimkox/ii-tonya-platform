import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeProfessionalCard,
  decodeCardEntry,
  decodeCardPromoProof,
  normalizeCardEvent,
} from "./expert-card-repository.js";
const card = {
  displayName: "Анна",
  profession: "Психолог",
  city: "Москва",
  summary: "Индивидуальные консультации для взрослых.",
};
const event = {
  botKey: "work-fixture",
  botId: "717171",
  telegramUserId: "920001",
  chatId: "920001",
  requestKey: "717171:42",
  requestDigest: "a".repeat(64),
};
describe("professional card private/public contracts", () => {
  it("accepts only explicit professional fields independently from private raw entries", () =>
    expect(decodeProfessionalCard(card)).toEqual(card));
  it.each([
    { ...card, phone: "79991234567" },
    { ...card, document: "telegram:file:diploma" },
    { ...card, summary: "Связь: user@example.test" },
    { ...card, summary: "https://example.test/contact" },
    { ...card, summary: "telegram:file:SECRET_ID" },
    { ...card, summary: "rfpg:private-diploma" },
    { ...card, summary: "Связь ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｔｅｓｔ" },
    { ...card, summary: "７９９９１２３４５６７" },
    { ...card, summary: "Запись +7 (999) 123-45-67" },
    { ...card, displayName: "x".repeat(81) },
    { ...card, summary: "x".repeat(2001) },
    { ...card, profession: "" },
    { ...card, city: "bad\u0000city" },
  ])("rejects private contact/document/oversized content %#", (value) =>
    expect(() => decodeProfessionalCard(value)).toThrow(
      "card_invalid_public_payload",
    ),
  );
  it("stores bounded raw text as private data without copying it to a public card", () =>
    expect(
      decodeCardEntry({ kind: "text", text: "Личная анкета: 79991234567" }),
    ).toEqual({ kind: "text", text: "Личная анкета: 79991234567" }));
  it.each(["photo", "document"] as const)(
    "keeps %s as an opaque Telegram reference, without fetch authority",
    (kind) =>
      expect(
        decodeCardEntry({
          kind,
          reference: "telegram:file:synthetic_file_123",
        }),
      ).toEqual({ kind, reference: "telegram:file:synthetic_file_123" }),
  );
  it.each([
    { kind: "text", text: "hello", reference: "telegram:file:extra" },
    { kind: "text", text: "x".repeat(4001) },
    { kind: "document", reference: "https://example.test/file" },
    { kind: "photo", reference: "telegram:file:bad token" },
    { kind: "text", text: "\u0000" },
  ])("rejects unbounded or mixed raw input %#", (value) =>
    expect(() => decodeCardEntry(value)).toThrow("card_invalid_entry"),
  );
  it("accepts a bounded public HTTPS promo-proof link as private proof only", () =>
    expect(
      decodeCardPromoProof({
        kind: "link",
        reference: "https://example.test/proof/123",
      }),
    ).toEqual({ kind: "link", reference: "https://example.test/proof/123" }));
  it.each([
    "http://example.test/proof",
    "https://user:secret@example.test/proof",
    "https://127.0.0.1/proof",
    "https://10.0.0.1/proof",
    "https://localhost/proof",
    "https://[::1]/proof",
    "file:///tmp/proof",
  ])("rejects unsafe proof reference %s", (reference) =>
    expect(() => decodeCardPromoProof({ kind: "link", reference })).toThrow(
      "card_invalid_proof",
    ),
  );
  it("normalizes numeric bot/update identity into the global C replay namespace", () =>
    expect(normalizeCardEvent(event)).toMatchObject({
      ...event,
      updateId: "42",
    }));
  it.each([
    { ...event, requestKey: "717171:42:entry" },
    { ...event, requestKey: "999:42" },
    { ...event, requestKey: "717171:0042" },
    { ...event, chatId: "-55" },
    { ...event, requestDigest: "bad" },
  ])(
    "rejects spoofed private scope or operation-specific replay keys %#",
    (value) =>
      expect(() => normalizeCardEvent(value)).toThrow("card_invalid_event"),
  );
});

describe("PostgreSQL media constraint compatibility", () => {
  const migration = readFileSync(
    new URL(
      "../../migrations/0054_expert_card_publication.sql",
      import.meta.url,
    ),
    "utf8",
  );
  it("keeps every SQL ARE repetition within the PostgreSQL-supported bound", () => {
    for (const expression of migration.matchAll(/~\*?\s*'((?:''|[^'])*)'/gu)) {
      for (const repetition of expression[1]!.matchAll(
        /\{(\d+)(?:,(\d*))?\}/gu,
      )) {
        expect(Number(repetition[1])).toBeLessThanOrEqual(255);
        if (repetition[2] !== undefined && repetition[2] !== "")
          expect(Number(repetition[2])).toBeLessThanOrEqual(255);
      }
    }
  });
  it("preserves nonnull charset and 1..512 opaque ID limits outside SQL regex counts", () => {
    expect(migration.includes("media_reference IS NOT NULL")).toBe(true);
    expect(
      migration.includes("char_length(media_reference) BETWEEN 15 AND 526"),
    ).toBe(true);
    expect(
      migration.includes("char_length(reference) BETWEEN 15 AND 526"),
    ).toBe(true);
    for (const kind of ["photo", "document"] as const) {
      expect(
        decodeCardEntry({
          kind,
          reference: `telegram:file:${"a".repeat(512)}`,
        }),
      ).toMatchObject({ kind });
      expect(() =>
        decodeCardEntry({
          kind,
          reference: `telegram:file:${"a".repeat(513)}`,
        }),
      ).toThrow("card_invalid_entry");
    }
  });
});
