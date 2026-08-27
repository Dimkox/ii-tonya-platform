import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const parseEnv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );

describe("environment credential policy", () => {
  it("tracks only a placeholder example and keeps every live flag false", () => {
    const ignored = readFileSync(".gitignore", "utf8").split(/\r?\n/);
    expect(ignored).toEqual(
      expect.arrayContaining([".env", ".env.*", "!.env.example"]),
    );

    const example = parseEnv(readFileSync(".env.example", "utf8"));
    const liveFlags = Object.keys(example).filter((key) =>
      key.endsWith("_ENABLED"),
    );
    expect(liveFlags).toEqual(
      expect.arrayContaining([
        "LLM_ENABLED",
        "GOOGLE_SHEETS_PROJECTION_ENABLED",
        "MINOR_ONBOARDING_ENABLED",
        "EXPERT_REFERRAL_ENABLED",
        "EXPERT_RESIDENCY_BILLING_ENABLED",
        "EXPERT_TELEGRAM_QUERIES_ENABLED",
        "EXPERT_TELEGRAM_FINANCIAL_VIEWS_ENABLED",
        "EXPERT_TELEGRAM_REFERRAL_ENABLED",
        "EXPERT_TELEGRAM_CHECKOUT_ENABLED",
        "PAYMENTS_ENABLED",
        "WORKER_OUTBOX_DELIVERY_ENABLED",
        "CLIENT_CATALOG_ENABLED",
      ]),
    );
    expect(liveFlags.map((key) => example[key])).toEqual(
      liveFlags.map(() => "false"),
    );

    expect(example.EXPERT_REFERRAL_ENABLED).toBe("false");
    expect(example.EXPERT_RESIDENCY_BILLING_ENABLED).toBe("false");
    expect(example.EXPERT_TELEGRAM_QUERIES_ENABLED).toBe("false");
    expect(example.EXPERT_TELEGRAM_FINANCIAL_VIEWS_ENABLED).toBe("false");
    expect(example.EXPERT_TELEGRAM_REFERRAL_ENABLED).toBe("false");
    expect(example.EXPERT_TELEGRAM_CHECKOUT_ENABLED).toBe("false");
    expect(example.WORKER_OUTBOX_DELIVERY_ENABLED).toBe("false");
    expect(example.CLIENT_CATALOG_ENABLED).toBe("false");
    expect(example.PAYMENT_PROVIDER).toBe("disabled");
    expect(example.LLM_PROVIDER).toBe("disabled");

    expect(example.EXPERT_REFERRAL_HMAC_KEY_VERSION).toContain(
      "__PLACEHOLDER_",
    );
    expect(example.EXPERT_REFERRAL_HMAC_KEY_REF).toContain("__PLACEHOLDER_");
    expect(example.EXPERT_REFERRAL_HMAC_KEYS_JSON).toContain("__PLACEHOLDER_");

    const secretKeys = Object.keys(example).filter(
      (key) =>
        /(PASSWORD|TOKEN|SECRET|API_KEY|HMAC_KEY)$/.test(key) ||
        key === "DATABASE_URL",
    );
    expect(secretKeys.length).toBeGreaterThan(0);
    expect(
      secretKeys.every((key) => example[key]?.includes("__PLACEHOLDER_")),
    ).toBe(true);

    const tracked = execFileSync("git", ["ls-files"], {
      encoding: "utf8",
    }).split(/\r?\n/);
    expect(
      tracked.filter(
        (path) => /^\.env(?:\.|$)/.test(path) && path !== ".env.example",
      ),
    ).toEqual([]);
  });
});
