/** Server-only opt-in capability. Endpoint is fixed; user input is never a URL to fetch.
 * https://yandex.com/maps-api/docs/geocoder-api/request.html */
export function createResidentGeocoder(options: {
  enabled: boolean;
  key?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const timeout = options.timeoutMs ?? 4000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 5000)
    throw Error("geocode_configuration");
  let active = false;
  return {
    async locate(
      address: string,
      outer: AbortSignal,
    ): Promise<{ kind: "located"; url: string } | { kind: "unavailable" }> {
      const unavailable = { kind: "unavailable" as const };
      if (
        !options.enabled ||
        !options.key ||
        active ||
        typeof address !== "string" ||
        address.trim().length < 1 ||
        address.length > 1000
      )
        return unavailable;
      const signal = AbortSignal.any([outer, AbortSignal.timeout(timeout)]);
      active = true;
      try {
        const u = new URL("https://geocode-maps.yandex.ru/v1/");
        u.search = new URLSearchParams({
          apikey: options.key,
          geocode: address,
          format: "json",
          lang: "ru_RU",
          results: "2",
        }).toString();
        const response = await (options.fetch ?? fetch)(u, {
          signal,
          redirect: "error",
        });
        if (!response.ok || !response.body) return unavailable;
        const reader = response.body.getReader(),
          chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            signal.throwIfAborted();
            const r = await reader.read();
            if (r.done) break;
            size += r.value.length;
            if (size > 32768) return unavailable;
            chunks.push(r.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const body = JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
        const collection = body?.response?.GeoObjectCollection;
        if (
          collection?.metaDataProperty?.GeocoderResponseMetaData?.found !==
            "1" ||
          !Array.isArray(collection.featureMember) ||
          collection.featureMember.length !== 1
        )
          return unavailable;
        const item = collection.featureMember[0]?.GeoObject,
          meta = item?.metaDataProperty?.GeocoderMetaData,
          pos = item?.Point?.pos;
        if (
          meta?.precision !== "exact" ||
          meta?.kind !== "house" ||
          typeof pos !== "string" ||
          !/^[-+]?\d{1,3}(?:\.\d{1,12})? [-+]?\d{1,2}(?:\.\d{1,12})?$/u.test(
            pos,
          )
        )
          return unavailable;
        const [lon, lat] = pos.split(" ").map(Number);
        if (
          !Number.isFinite(lon) ||
          !Number.isFinite(lat) ||
          Math.abs(lon!) > 180 ||
          Math.abs(lat!) > 90 ||
          signal.aborted
        )
          return unavailable;
        return {
          kind: "located",
          url: `https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map`,
        };
      } catch {
        return unavailable;
      } finally {
        active = false;
      }
    },
  };
}
