import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  diffExpertProposalDistribution,
  evaluateExpertProposalDistribution,
} from "./expert-ai-proposal-eval.js";

const tariffVersionId = "00000000-0000-4000-8000-000000000003";

describe("expert proposal distribution evidence", () => {
  it("records only bounded outcome counts and produces a deterministic zero diff", () => {
    const corpus = [
      { kind: "view_referral_summary" },
      { kind: "quote_residency", tariffVersionId },
      { kind: "start_residency_checkout", tariffVersionId },
      { kind: "set_residency_price", priceMinor: "1" },
    ];
    const baseline = evaluateExpertProposalDistribution(corpus);
    expect(baseline).toEqual({
      total: 4,
      accepted: {
        quote_residency: 1,
        start_residency_checkout: 1,
        view_referral_summary: 1,
      },
      rejected: { unsupported_intent: 1 },
    });
    expect(diffExpertProposalDistribution(baseline, baseline)).toEqual({
      changed: false,
      deltas: {},
    });
    expect(JSON.stringify(baseline)).not.toContain(tariffVersionId);
  });

  it("matches the committed fixture baseline without retaining fixture values", () => {
    const names = [
      "expert-ai-safe-01-redeem",
      "expert-ai-safe-02-summary",
      "expert-ai-safe-03-quote",
      "expert-ai-safe-04-checkout",
      "llm-05-set-referral-balance",
      "llm-06-set-referral-code",
      "llm-07-set-residency-price",
      "llm-08-fake-settlement",
      "llm-09-cross-expert-referral",
    ];
    const outputs = names.map(
      (name) =>
        (
          JSON.parse(
            readFileSync(`tests/fixtures/prompts/${name}.json`, "utf8"),
          ) as { modelOutput: unknown }
        ).modelOutput,
    );
    const baseline = JSON.parse(
      readFileSync(
        "tests/fixtures/prompts/expert-ai-distribution-baseline.json",
        "utf8",
      ),
    ) as {
      distribution: ReturnType<typeof evaluateExpertProposalDistribution>;
    };
    const candidate = evaluateExpertProposalDistribution(outputs);
    expect(candidate).toEqual(baseline.distribution);
    expect(
      diffExpertProposalDistribution(baseline.distribution, candidate),
    ).toEqual({ changed: false, deltas: {} });
  });
});
