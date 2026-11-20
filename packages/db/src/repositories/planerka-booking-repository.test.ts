import { describe, expect, it } from "vitest";
import {
  planerkaAttendeeName,
  planerkaMeetingUrl,
} from "./planerka-booking-repository.js";

describe("planerka attendee name and meeting link", () => {
  it("uses the profile name and falls back when it is empty", () => {
    expect(planerkaAttendeeName("  Мария  ")).toBe("Мария");
    expect(planerkaAttendeeName("")).toBe("Клиент");
    expect(planerkaAttendeeName(null)).toBe("Клиент");
    expect(planerkaAttendeeName("Анна\u0000")).toBe("Анна");
  });

  it("keeps an https video link and rejects anything else", () => {
    expect(planerkaMeetingUrl("https://video.planerka.app/room")).toBe(
      "https://video.planerka.app/room",
    );
    expect(planerkaMeetingUrl("")).toBeNull();
    expect(planerkaMeetingUrl(undefined)).toBeNull();
    expect(() => planerkaMeetingUrl("http://video.planerka.app/room")).toThrow(
      "planerka_binding_mismatch",
    );
  });
});
