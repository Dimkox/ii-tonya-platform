import { describe, expect, it } from "vitest";

import { guardClientCopy } from "../../packages/domain/src/index.js";
import { landingContent } from "../../apps/web/src/content.js";

const publicCopyStrings = (
  value: unknown,
  path = "landingContent",
): { readonly path: string; readonly text: string }[] => {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      publicCopyStrings(item, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) =>
      publicCopyStrings(nested, `${path}.${key}`),
    );
  }
  return [];
};

describe("public copy obeys the client copy guard", () => {
  const strings = publicCopyStrings(landingContent);

  it("walks the whole landing document", () => {
    expect(strings.length).toBeGreaterThan(120);
  });

  it("rejects nothing that the guard would reject in a client answer", () => {
    const violations = strings.flatMap(({ path, text }) => {
      const result: ReturnType<typeof guardClientCopy> = guardClientCopy(text);
      return result.accepted ? [] : [`${path} → ${result.reasonCode}`];
    });

    expect(violations).toEqual([]);
  });

  it("is not vacuous: the same guard rejects a banned rewrite", () => {
    expect(
      guardClientCopy("Я подбираю лучшие варианты из моей базы."),
    ).toEqual({ accepted: false, reasonCode: "prohibited_copy_marketing_term" });
    expect(
      guardClientCopy("ии-Тоня рекомендует вас клиентам под их запросы."),
    ).toEqual({ accepted: false, reasonCode: "prohibited_copy_marketing_term" });
    expect(guardClientCopy("Привет, я ИИ Тоня.")).toEqual({
      accepted: false,
      reasonCode: "client_copy_brand_name_variant",
    });
  });
});
