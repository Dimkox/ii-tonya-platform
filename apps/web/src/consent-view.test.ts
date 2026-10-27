import { expect, it } from "vitest";
import { renderConsentPage, renderMyDataPage } from "./consent-view.js";
it("offers login before collection controls and no automatic third-party script", () => {
  for (const html of [renderConsentPage(), renderMyDataPage()]) {
    expect(html).toContain("data-login");
    expect(html).not.toContain("data-consent-form");
    // The only pre-login checkbox belongs to the hidden deletion confirmation,
    // not a collection-consent form; deletion stays disabled until authenticated.
    expect(html.match(/<input[^>]*type="checkbox"[^>]*>/gu)).toEqual([
      '<input type="checkbox" data-erasure-saved>',
    ]);
    expect(html).toMatch(
      /<div data-erasure-confirm hidden>[\s\S]*data-erasure-saved/u,
    );
    expect(html).toContain("data-erasure-prepare disabled");
    expect(html).toContain("data-erasure-send disabled");
    expect(html).not.toContain("data-erase-data");
    expect(html).not.toContain("<script");
  }
});
