import { describe, it, expect } from "vitest";
import {
  richProfileSchema,
  richProfileGaps,
  richPreviewPages,
  proposeRichFields,
  richChecklist,
  richServiceSchema,
  type RichService,
  type RichProfile,
} from "./resident-rich-profile.js";
const bio =
  "Помогаю разобраться в жизненных задачах и найти собственные решения без обещаний результата.";
export const service: RichService = {
  id: "66000000-0000-4000-8000-000000000001",
  title: "Консультация",
  format: "ONLINE",
  eventDelivery: null,
  durationMinutes: 60,
  price: { kind: "exact", minRub: "2500.00", maxRub: null },
  description: bio,
  audience: "Взрослые",
  result: "План следующих шагов",
  expiryDate: null,
  detailsUrl: null,
  tags: ["#поддержка"],
};
export const profile: RichProfile = {
  fullName: "Анна",
  specialization: "Консультант",
  bio,
  photos: [
    "66000000-0000-4000-8000-000000000002",
    "66000000-0000-4000-8000-000000000003",
    "66000000-0000-4000-8000-000000000004",
  ],
  socialLinks: ["https://example.com/profile"],
  onlineRoomType: "STATIC_LINK",
  staticRoomLink: "https://example.com/room",
  address: "",
  arrival: "",
  yandexMapsUrl: null,
  services: [service],
};
describe("rich private profile contract", () => {
  it("accepts complete typed catalogue with exact informational amounts", () => {
    expect(richProfileSchema.parse(profile)).toEqual(profile);
    expect(richProfileGaps(profile)).toEqual([]);
  });
  it.each(["1e3", "1.001", "-1.00", "999999999999999999999.99", "01.00"])(
    "rejects ambiguous money %s",
    (amount) =>
      expect(() =>
        richServiceSchema.parse({
          ...service,
          price: { kind: "exact", minRub: amount, maxRub: null },
        }),
      ).toThrow(),
  );
  it("rejects reversed ranges and invalid calendar dates", () => {
    expect(() =>
      richServiceSchema.parse({
        ...service,
        price: { kind: "range", minRub: "3.00", maxRub: "2.00" },
      }),
    ).toThrow();
    expect(() =>
      richServiceSchema.parse({ ...service, expiryDate: "2027-02-29" }),
    ).toThrow();
  });
  it("requires distinct photos, deep text, tags and conditional logistics", () => {
    expect(
      richProfileGaps({
        ...profile,
        photos: [profile.photos[0]!, profile.photos[0]!],
        bio: "мало",
        onlineRoomType: "UNDECIDED",
        services: [
          {
            ...service,
            format: "EVENT",
            eventDelivery: "HYBRID",
            description: "мало",
            tags: [],
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "photos",
        "bio",
        "onlineRoomType",
        "address",
        "arrival",
        "services.0.description",
        "services.0.tags",
      ]),
    );
  });
  it.each([
    "http://example.com",
    "https://127.0.0.1",
    "https://[::ffff:127.0.0.1]",
    "https://localhost",
    "https://example.com:8443",
    "https://a:b@example.com",
  ])("rejects unsafe private URLs %s", (url) =>
    expect(() =>
      richProfileSchema.parse({ ...profile, staticRoomLink: url }),
    ).toThrow(),
  );
  it("never truncates bounded Unicode preview content", () => {
    const p = {
      ...profile,
      bio: "Ю".repeat(2000),
      services: Array.from({ length: 8 }, (_, i) => ({
        ...service,
        id: `66000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
        description: "Ё".repeat(2000),
      })),
    };
    const pages = richPreviewPages(p);
    expect(pages.every((x) => x.length <= 3000)).toBe(true);
    expect(pages.join("")).toContain("Ю".repeat(2000));
    expect(pages.join("").match(/Ё/g)?.length).toBe(16000);
  });
  it("extracts labelled proposals only without inventing missing answers", () => {
    expect(proposeRichFields("fullName: Анна\nspecialization: Коуч")).toEqual({
      fullName: "Анна",
      specialization: "Коуч",
    });
    expect(proposeRichFields("https://example.com")).toEqual({});
    expect(richChecklist()).toContain("Длительность, минут:");
  });
});
it("guides a service in Russian without JSON or user UUID, preserving exact price and asking only gaps", async () => {
  const { guidedRichAnswer, guidedRichQuestion, emptyRichProfile } =
    await import("./resident-rich-profile.js");
  let p = {
    ...emptyRichProfile(),
    fullName: "Анна",
    specialization: "Консультант",
    bio,
    socialLinks: ["https://example.com/profile"],
  };
  let staged = {};
  expect(guidedRichQuestion(p, staged)).toContain("название услуги");
  for (const answer of [
    "Консультация",
    "онлайн",
    "60",
    "2500,50",
    bio,
    "Взрослые",
    "План следующих шагов",
    "поддержка, развитие",
    "нет",
    "нет",
  ]) {
    const r = guidedRichAnswer(p, staged, answer, () => service.id);
    p = r.profile;
    staged = r.staged;
  }
  expect(p.services[0]).toMatchObject({
    id: service.id,
    durationMinutes: 60,
    price: { kind: "exact", minRub: "2500.50", maxRub: null },
  });
  expect(guidedRichQuestion(p, staged)).toContain("постоянной онлайн-комнаты");
  expect(richChecklist()).toContain("Название услуги:");
  expect(richChecklist()).not.toContain("UUID");
  const view = richPreviewPages(p).join("");
  expect(view).toContain("Стоимость");
  expect(view).not.toContain('"minRub"');
});
