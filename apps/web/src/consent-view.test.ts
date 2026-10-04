import { describe, expect, it } from "vitest";

import {
  consentPolicyVersions,
  renderConsentPage,
  renderMyDataPage,
} from "./consent-view.js";

describe("client privacy views", () => {
  it("renders separate, explicit consent purposes", () => {
    const html = renderConsentPage();
    expect(html).toContain('data-consent-purpose="client_messaging"');
    expect(html).toContain('data-consent-purpose="client_profile"');
    expect(html).toContain("Каждая цель управляется отдельно");
    expect(html).not.toMatch(/token|localStorage|analytics|telegram/iu);
  });

  it("keeps policy versions owned by the server consent contract", () => {
    expect(consentPolicyVersions).toEqual({
      client_messaging: "messaging-v1",
      client_profile: "profile-v1",
    });
  });

  it("renders export and erasure controls without embedding identity data", () => {
    const html = renderMyDataPage();
    expect(html).toContain("data-export-data");
    expect(html).toContain("data-erase-data");
    expect(html).toContain("Начать удаление");
    expect(html).not.toMatch(/userId|email|phone|bearer/iu);
  });
});
