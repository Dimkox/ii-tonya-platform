export interface PublicCatalogItem {
  displayName: string;
  serviceCode: string;
  language: string;
}

const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.replace(
    /[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cf}\p{M}\u2800]/gu,
    "",
  ).length > 0 &&
  value.length <= max &&
  !/[\p{Cc}\p{Bidi_Control}]/u.test(value);

async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const limit = 65_536;
  const length = response.headers.get("content-length");
  if (
    !response.ok ||
    signal.aborted ||
    (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit))
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("catalog_unavailable");
  }
  if (!response.body) throw new Error("catalog_unavailable");
  const reader = response.body.getReader();
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    // Cancellation must not extend the whole request/body deadline.
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new Error("catalog_unavailable");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error("catalog_unavailable");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    cancel();
    throw new Error("catalog_unavailable");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function decodeCatalog(value: unknown): PublicCatalogItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_catalog");
  const rows = (value as Record<string, unknown>).items;
  if (!Array.isArray(rows) || rows.length > 20)
    throw new Error("invalid_catalog");
  return rows.map((row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new Error("invalid_catalog");
    const { displayName, serviceCode, language } = row as Record<
      string,
      unknown
    >;
    if (
      !validText(displayName, 200) ||
      !validText(serviceCode, 64) ||
      !validText(language, 32)
    )
      throw new Error("invalid_catalog");
    return { displayName, serviceCode, language };
  });
}

export class PublicCatalogClient {
  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly options: { timeoutMs?: number } = {},
  ) {}
  async list(): Promise<PublicCatalogItem[]> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("catalog_unavailable"));
      }, this.options.timeoutMs ?? 10_000);
    });
    try {
      return await Promise.race([
        timeout,
        (async () => {
          const response = await this.request("/v1/public/catalog", {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
          return decodeCatalog(
            await readBoundedJson(response, controller.signal),
          );
        })(),
      ]);
    } catch {
      throw new Error("catalog_unavailable");
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
