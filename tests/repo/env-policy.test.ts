import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

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
      ]),
    );
    expect(liveFlags.map((key) => example[key])).toEqual(
      liveFlags.map(() => "false"),
    );

    expect(example.PAYMENT_PROVIDER).toBe("disabled");
    expect(example.LLM_PROVIDER).toBe("disabled");

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

  it("keeps expert referral ceilings off and commits only safe key metadata", () => {
    const exampleText = readFileSync(".env.example", "utf8");
    const runtimeText = readFileSync("deploy/runtime.env.example", "utf8");
    const example = parseEnv(exampleText);
    const runtime = parseEnv(runtimeText);
    const compose = parse(readFileSync("compose.yaml", "utf8")) as {
      "x-disabled-runtime": Record<string, string>;
    };

    for (const source of [example, runtime, compose["x-disabled-runtime"]]) {
      expect(source.EXPERT_REFERRAL_ENABLED).toBe("false");
      expect(source.EXPERT_RESIDENCY_BILLING_ENABLED).toBe("false");
      expect(source.EXPERT_REFERRAL_HMAC_KEY_VERSION).toBe("v1");
      expect(source.EXPERT_REFERRAL_HMAC_KEY_REF).toBe(
        "env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      );
      expect(source).not.toHaveProperty("EXPERT_REFERRAL_HMAC_KEYS_JSON");
    }
    expect(exampleText).toContain(
      "EXPERT_REFERRAL_HMAC_KEYS_JSON is secret-managed and intentionally absent",
    );
    expect(runtimeText).toContain(
      "EXPERT_REFERRAL_HMAC_KEYS_JSON is secret-managed and intentionally absent",
    );
  });

  it("validates a release only with disabled expert ceilings and no inline key map", () => {
    const directory = mkdtempSync(join(tmpdir(), "ii-tonya-expert-env-"));
    const runtimeFile = join(directory, "runtime.env");
    const releaseSha = "a".repeat(40);
    const valid = [
      "NODE_ENV=production",
      "DATABASE_URL=postgresql://user:pass@db.internal/app?sslmode=verify-full",
      "ALLOW_INSECURE_LOCAL_DATABASE=false",
      `MIGRATION_COMPATIBILITY_APPROVED_SHA=${releaseSha}`,
      "MINOR_ONBOARDING_ENABLED=false",
      "SELARTI_ENABLED=false",
      "PLANERKA_ENABLED=false",
      "TELEGRAM_ENABLED=false",
      "PAYMENTS_ENABLED=false",
      "LLM_ENABLED=false",
      "INTENT_MODEL_ENABLED=false",
      "MAKE_PROJECTION_ENABLED=false",
      "GOOGLE_SHEETS_PROJECTION_ENABLED=false",
      "RAW_CONVERSATION_LOGGING=false",
      "EXPERT_REFERRAL_ENABLED=false",
      "EXPERT_RESIDENCY_BILLING_ENABLED=false",
      "EXPERT_REFERRAL_HMAC_KEY_VERSION=v1",
      "EXPERT_REFERRAL_HMAC_KEY_REF=env://EXPERT_REFERRAL_HMAC_KEYS_JSON",
      "SELARTI_OUTBOUND_BILLING_MODE=disabled",
      "PAYMENT_PROVIDER=disabled",
      "LLM_PROVIDER=disabled",
      "",
    ].join("\n");
    writeFileSync(runtimeFile, valid);

    expect(() =>
      execFileSync(
        "bash",
        ["scripts/validate-runtime-env.sh", runtimeFile, releaseSha],
        { encoding: "utf8" },
      ),
    ).not.toThrow();

    writeFileSync(
      runtimeFile,
      `${valid}EXPERT_REFERRAL_HMAC_KEYS_JSON={"v1":"inline"}\n`,
    );
    expect(() =>
      execFileSync(
        "bash",
        ["scripts/validate-runtime-env.sh", runtimeFile, releaseSha],
        { encoding: "utf8", stdio: "pipe" },
      ),
    ).toThrow();
  });
});
