import { describe, expect, it } from "vitest";
import {
  ExpertServiceOfferInvalidError,
  formatExpertServiceOfferLine,
  formatExpertServicePrice,
  parseExpertServiceOffer,
  projectExpertServiceOffer,
} from "./expert-service-offer.js";

const offer = (patch: Record<string, unknown> = {}) =>
  parseExpertServiceOffer({
    priceMinor: null,
    format: null,
    location: null,
    ...patch,
  });

describe("expert service offer", () => {
  it("formats whole rubles and kopecks", () => {
    expect(formatExpertServicePrice(300_000)).toBe("3 000 ₽");
    expect(formatExpertServicePrice(300_050)).toBe("3 000,50 ₽");
    expect(formatExpertServicePrice(0)).toBe("0 ₽");
  });

  it("hides empty facts and labels format in Russian", () => {
    expect(formatExpertServiceOfferLine({})).toBe("");
    expect(
      formatExpertServiceOfferLine({
        priceMinor: 300_000,
        currency: "RUB",
        format: "hybrid",
        location: "Москва, Арбат",
      }),
    ).toBe("3 000 ₽ · Онлайн/офлайн · Москва, Арбат");
    expect(formatExpertServiceOfferLine({ format: "online" })).toBe("Онлайн");
    expect(formatExpertServiceOfferLine({ format: "offline" })).toBe("Офлайн");
  });

  it("rejects a negative price, a bad format, and offline without a location", () => {
    expect(() => offer({ priceMinor: -1 })).toThrow(
      ExpertServiceOfferInvalidError,
    );
    expect(() => offer({ priceMinor: -1 })).toThrow(/:price$/);
    expect(() => offer({ format: "EVENT" })).toThrow(/:format$/);
    expect(() => offer({ format: "offline" })).toThrow(/:location$/);
    expect(() => offer({ format: "hybrid" })).toThrow(/:location$/);
    expect(offer({ format: "online" })).toMatchObject({
      format: "online",
      location: null,
      priceMinor: null,
      currency: "RUB",
    });
    expect(
      offer({ format: "offline", location: "Казань", priceMinor: 150_000 }),
    ).toMatchObject({
      format: "offline",
      location: "Казань",
      priceMinor: 150_000,
    });
  });

  it("omits nulls from the public projection", () => {
    expect(
      projectExpertServiceOffer({
        currency: "RUB",
        format: null,
        location: null,
      }),
    ).toEqual({});
    expect(
      projectExpertServiceOffer({
        priceMinor: "300000",
        currency: "RUB",
        format: "online",
        location: null,
      }),
    ).toEqual({ priceMinor: 300_000, currency: "RUB", format: "online" });
  });
});
