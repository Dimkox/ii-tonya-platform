import { it, expect, vi } from "vitest";
import { createResidentGeocoder } from "./resident-geocode.js";
it("disabled geocoder performs zero calls", async () => {
  const transport = vi.fn();
  expect(
    await createResidentGeocoder({ enabled: false, fetch: transport }).locate(
      "Адрес",
      AbortSignal.timeout(100),
    ),
  ).toEqual({ kind: "unavailable" });
  expect(transport).not.toHaveBeenCalled();
});
it("accepts only one exact house with finite bounded coordinates at fixed endpoint", async () => {
  const transport = vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(
      JSON.stringify({
        response: {
          GeoObjectCollection: {
            metaDataProperty: { GeocoderResponseMetaData: { found: "1" } },
            featureMember: [
              {
                GeoObject: {
                  metaDataProperty: {
                    GeocoderMetaData: { precision: "exact", kind: "house" },
                  },
                  Point: { pos: "37.6 55.7" },
                },
              },
            ],
          },
        },
      }),
    );
  });
  const r = await createResidentGeocoder({
    enabled: true,
    key: "synthetic",
    fetch: transport,
  }).locate("Адрес", AbortSignal.timeout(100));
  expect(r).toEqual({
    kind: "located",
    url: "https://yandex.ru/maps/?pt=37.6,55.7&z=17&l=map",
  });
  expect(new URL(String(transport.mock.calls[0]![0])).origin).toBe(
    "https://geocode-maps.yandex.ru",
  );
});
it("ambiguous/invalid/oversized response and transport errors retain manual fallback", async () => {
  for (const body of ["{}", "x".repeat(32769)]) {
    expect(
      await createResidentGeocoder({
        enabled: true,
        key: "synthetic",
        fetch: async () => new Response(body),
      }).locate("Адрес", AbortSignal.timeout(100)),
    ).toEqual({ kind: "unavailable" });
  }
});
