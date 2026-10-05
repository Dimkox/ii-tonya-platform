import { expect, it } from "vitest";
import { renderConsentPage, renderMyDataPage } from "./consent-view.js";
it("offers login before collection controls and no automatic third-party script", () => {
  for (const html of [renderConsentPage(), renderMyDataPage()]) {
    expect(html).toContain("data-login");
    expect(html).not.toContain("data-consent-form");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("data-erase-data");
    expect(html).not.toContain("<script");
  }
});
