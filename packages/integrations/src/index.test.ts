import { describe, expect, it } from "vitest";

describe("public expert Telegram package surface", () => {
  it("exports the ct3 and safe renderer runtime APIs from the package index", async () => {
    const api = await import("@ii-tonya/integrations");

    expect(api.authenticateExpertCommandCallback).toBeTypeOf("function");
    expect(api.issueExpertCommandCallback).toBeTypeOf("function");
    expect(api.verifyExpertCommandCallback).toBeTypeOf("function");
    expect(api.renderExpertReferralSummary).toBeTypeOf("function");
    expect(api.renderExpertResidencyQuote).toBeTypeOf("function");
  });
});
