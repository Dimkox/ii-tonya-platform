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
  it("keeps the test credential inventory non-secret and fail-closed", () => {
    const inventory = readFileSync(
      "docs/runbooks/test-credential-inventory.md",
      "utf8",
    );
    expect(inventory).toContain("Test credential inventory");
    expect(inventory).toContain("Every external capability is default-off");
    expect(inventory).toContain("2026-09-07");
    for (const capability of [
      "Expert promo Telegram bot",
      "Unified client Telegram bot",
      "Planerka",
      "YooKassa",
      "Selarti",
      "MAX Business",
    ]) {
      expect(inventory).toMatch(
        new RegExp(
          `${capability}[\\s\\S]{0,240}default-off[\\s\\S]{0,240}fail-closed`,
          "i",
        ),
      );
    }
    expect(inventory).not.toMatch(
      /(?:^|[^\w])(?:sk_(?:live|test)_|rk_(?:live|test)_|pk_(?:live|test)_|xox[baprs]-|gh[pousr]_|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+)[A-Za-z0-9_./+=-]{12,}/im,
    );
    expect(inventory).not.toMatch(
      /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|\b(?:api[_-]?key|token|secret|credential|assignment|account|project|calendar|channel|resource|webhook)[_-]?(?:id|value|ref)?\s*[:=]\s*[A-Za-z0-9][A-Za-z0-9_./+=:-]{15,}/im,
    );
    const assignments = [
      ...inventory.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)=([^\s`|]+)/g),
    ].map(([, key, value]) => `${key}=${value}`);
    expect(assignments).toEqual(["YOOKASSA_SHOP_ID=1437535"]);
  });

  it("tracks only a placeholder example and keeps every live flag false", () => {
    const ignored = readFileSync(".gitignore", "utf8").split(/\r?\n/);
    expect(ignored).toEqual(
      expect.arrayContaining([
        ".env",
        ".env.*",
        "!.env.example",
        ".grok-stack/runtime/*",
        "!.grok-stack/runtime/.gitkeep",
        ".coverage",
        ".coverage.*",
      ]),
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

  it("declares each environment name exactly once in the tracked templates", () => {
    // parseEnv collapses duplicate keys onto the last value, which is how a
    // repeated assignment survived unnoticed in .env.example; count raw lines.
    for (const file of [".env.example", "deploy/runtime.env.example"]) {
      const names = readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((line) => /^[A-Z0-9_]+=/u.test(line))
        .map((line) => line.slice(0, line.indexOf("=")));

      const duplicates = [
        ...new Set(
          names.filter((name, index) => names.indexOf(name) !== index),
        ),
      ];
      expect(duplicates, `${file} duplicate names`).toEqual([]);
      expect(names.length).toBeGreaterThan(0);
    }
  });
});
