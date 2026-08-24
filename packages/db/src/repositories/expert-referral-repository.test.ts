import { describe, expect, it } from "vitest";
import {
  computeExpertReferralOverrideConsumption,
  validateExpertReferralBatchSize,
} from "./expert-referral-repository.js";

describe("expert referral issuance limits", () => {
  it("accepts only complete batches from one through one thousand", () => {
    expect(validateExpertReferralBatchSize(1)).toBe(1);
    expect(validateExpertReferralBatchSize(1000)).toBe(1000);
    expect(() => validateExpertReferralBatchSize(0)).toThrow(
      "invalid_expert_code_batch_size",
    );
    expect(() => validateExpertReferralBatchSize(1001)).toThrow(
      "invalid_expert_code_batch_size",
    );
    expect(() => validateExpertReferralBatchSize(1.5)).toThrow(
      "invalid_expert_code_batch_size",
    );
  });

  it("consumes only the greatest bounded quota overage", () => {
    expect(
      computeExpertReferralOverrideConsumption({
        requestedCount: 25,
        outstandingCount: 990,
        rollingCount: 980,
      }),
    ).toBe(15);
    expect(
      computeExpertReferralOverrideConsumption({
        requestedCount: 10,
        outstandingCount: 100,
        rollingCount: 100,
      }),
    ).toBe(0);
    expect(
      computeExpertReferralOverrideConsumption({
        requestedCount: 5,
        outstandingCount: 1015,
        rollingCount: 1005,
      }),
    ).toBe(5);
  });
});
