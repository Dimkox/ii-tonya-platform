import { describe, expect, it } from "vitest";
import { renderFinalCallMessage } from "./early-bird-final-call-message.js";

describe("early bird final call", () => {
  it("presents the locked base amount and provider payment link", () => {
    const message = renderFinalCallMessage({
      name: "Анна",
      clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
      basePriceMinor: 800000n,
      checkoutUrl: "https://yoomoney.ru/checkout/payments/example",
    });
    expect(message).toContain("Анна");
    expect(message).toContain("8 000 ₽/мес");
    expect(message).toContain("11 января 2027");
    expect(message).toContain("10 января 2027");
    expect(message).toContain("https://yoomoney.ru/checkout/payments/example");
    expect(message).toContain("Акция «Энергия начала» завершена");
  });

  it("uses the configured launch date rather than a fixed date", () => {
    const message = renderFinalCallMessage({
      name: "Анна",
      basePriceMinor: 800000n,
      checkoutUrl: "https://yookassa.ru/pay",
      clientStartAtMs: Date.parse("2027-02-11T21:00:00Z"),
    });
    expect(message).toContain("12 февраля 2027");
    expect(message).toContain("11 февраля 2027");
  });

  it("rejects non-provider, insecure and malformed URLs", () => {
    const base = {
      name: "Анна",
      basePriceMinor: 800000n,
      clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
    };
    for (const checkoutUrl of [
      "http://yookassa.ru/pay",
      "https://evil.example/pay",
      "https://yookassa.ru.evil.example/pay",
      "https://user@yookassa.ru/pay",
      "https://yookassa.ru/pay#redirect",
      "not a URL",
    ]) {
      expect(() => renderFinalCallMessage({ ...base, checkoutUrl })).toThrow();
    }
  });

  it("rejects invalid amounts and a name containing message control characters", () => {
    const base = {
      name: "Анна",
      clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
      basePriceMinor: 800000n,
      checkoutUrl: "https://yookassa.ru/pay",
    };
    expect(() =>
      renderFinalCallMessage({ ...base, basePriceMinor: -1n }),
    ).toThrow();
    expect(() =>
      renderFinalCallMessage({ ...base, basePriceMinor: 0n }),
    ).toThrow();
    expect(() =>
      renderFinalCallMessage({ ...base, name: "Анна\nПоддельная ссылка" }),
    ).toThrow();
  });

  it("preserves kopecks and arbitrary precision without rounding", () => {
    const text = renderFinalCallMessage({
      name: "Ирина",
      clientStartAtMs: Date.parse("2027-01-10T21:00:00Z"),
      basePriceMinor: 12345678901n,
      checkoutUrl: "https://pay.yookassa.ru/pay",
    });
    expect(text).toContain("123 456 789,01 ₽/мес");
  });
});
