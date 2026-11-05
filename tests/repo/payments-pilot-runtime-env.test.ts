import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sha = "b".repeat(40);
const base: Record<string, string> = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:p@db/app?sslmode=verify-full",
  ALLOW_INSECURE_LOCAL_DATABASE: "false",
  MIGRATION_COMPATIBILITY_APPROVED_SHA: sha,
  SELARTI_OUTBOUND_BILLING_MODE: "disabled",
  PAYMENT_PROVIDER: "disabled",
  LLM_PROVIDER: "disabled",
  ...Object.fromEntries(
    [
      "MINOR_ONBOARDING_ENABLED",
      "SELARTI_ENABLED",
      "TELEGRAM_ENABLED",
      "PAYMENTS_ENABLED",
      "LLM_ENABLED",
      "INTENT_MODEL_ENABLED",
      "MAKE_PROJECTION_ENABLED",
      "GOOGLE_SHEETS_PROJECTION_ENABLED",
      "EXPERT_REFERRAL_ENABLED",
      "EXPERT_RESIDENCY_BILLING_ENABLED",
      "EXPERT_TELEGRAM_QUERIES_ENABLED",
      "RAW_CONVERSATION_LOGGING",
    ].map((flag) => [flag, "false"]),
  ),
};
const pilot: Record<string, string> = {
  PAYMENTS_ENABLED: "true",
  PAYMENT_PROVIDER: "yookassa",
  YOOKASSA_ENABLED: "true",
  YOOKASSA_MODE: "live",
  PAYMENTS_PILOT_ALLOWLIST: "11111111-2222-4333-8444-555555555555",
  PAYMENTS_PILOT_MAX_AMOUNT_RUB: "10",
  YOOKASSA_SHOP_ID: "123456",
  YOOKASSA_SECRET_KEY: "fixture_only_value_x",
  YOOKASSA_SECRET_REF: "env://YOOKASSA_SECRET_KEY",
  YOOKASSA_RETURN_URL: "https://ii-tonya.ru/pay/return",
  YOOKASSA_RECEIPT_VAT_CODE: "1",
  YOOKASSA_RECEIPT_PAYMENT_SUBJECT: "service",
  YOOKASSA_RECEIPT_PAYMENT_MODE: "full_payment",
};

const validate = (overrides: Record<string, string | undefined>) => {
  const dir = mkdtempSync(join(tmpdir(), "ii-tonya-pilot-env-"));
  const file = join(dir, "runtime.env");
  const env = { ...base, ...overrides };
  writeFileSync(
    file,
    `${Object.entries(env)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
  );
  return spawnSync("bash", ["scripts/validate-runtime-env.sh", file, sha], {
    encoding: "utf8",
  });
};

describe("validate-runtime-env payments pilot (SCRUM-518)", () => {
  it("keeps payments off by default", () => {
    expect(validate({}).status).toBe(0);
    expect(validate({ YOOKASSA_ENABLED: "true" }).status).not.toBe(0);
    expect(validate({ PAYMENT_PROVIDER: "yookassa" }).status).not.toBe(0);
  });

  it("locks the full guarded live pilot until the API runtime is wired", () => {
    // Codex P1 (#147): the API has no direct YooKassa runtime yet, so an
    // accepted pilot env would stop the API at startup. Activation stays locked.
    for (const env of [pilot, { ...pilot, PAYMENTS_PILOT_ALLOWLIST: "42" }]) {
      const result = validate(env);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("payments pilot activation is locked");
      expect(result.stderr).not.toContain("fixture_only_value_x");
    }
  });

  it.each([
    ["no allowlist", { PAYMENTS_PILOT_ALLOWLIST: undefined }, "ALLOWLIST"],
    ["two principals", { PAYMENTS_PILOT_ALLOWLIST: "1,2" }, "exactly one id"],
    [
      "cap above 10",
      { PAYMENTS_PILOT_MAX_AMOUNT_RUB: "11" },
      "between 1 and 10",
    ],
    ["zero cap", { PAYMENTS_PILOT_MAX_AMOUNT_RUB: "0" }, "between 1 and 10"],
    [
      "no cap",
      { PAYMENTS_PILOT_MAX_AMOUNT_RUB: undefined },
      "between 1 and 10",
    ],
    ["test shop", { YOOKASSA_MODE: "test" }, "YOOKASSA_MODE=live"],
    [
      "gateway provider",
      { PAYMENT_PROVIDER: "yookassa_gateway" },
      "PAYMENT_PROVIDER=yookassa",
    ],
    ["yookassa off", { YOOKASSA_ENABLED: "false" }, "YOOKASSA_ENABLED=true"],
    ["no secret", { YOOKASSA_SECRET_KEY: undefined }, "YOOKASSA_SECRET_KEY"],
    [
      "foreign return url",
      { YOOKASSA_RETURN_URL: "https://evil.example/r" },
      "YOOKASSA_RETURN_URL",
    ],
    [
      "residency billing",
      {
        EXPERT_RESIDENCY_BILLING_ENABLED: "true",
        EXPERT_TELEGRAM_BOT_TOKEN: "1:x",
      },
      "EXPERT_RESIDENCY_BILLING_ENABLED must be false",
    ],
    [
      "gateway file",
      { YOOKASSA_GATEWAY_CONFIG_FILE: "/etc/x.json" },
      "gateway",
    ],
  ])("refuses %s", (_name, overrides, message) => {
    const result = validate({ ...pilot, ...overrides });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain("fixture_only_value_x");
  });

  it("keeps the pilot checkout off unless explicitly enabled", () => {
    expect(
      validate({ PAYMENTS_PILOT_CHECKOUT_ENABLED: "true" }).stderr,
    ).toContain("requires PAYMENTS_ENABLED=true");
    const on = { ...pilot, PAYMENTS_PILOT_CHECKOUT_ENABLED: "true" };
    // Checkout checks pass; activation stays locked until the API runtime is startup-tested.
    expect(
      validate({ ...on, CLIENT_SESSION_ENABLED: "true" }).stderr,
    ).toContain("payments pilot activation is locked");
    expect(validate(on).stderr).toContain("CLIENT_SESSION_ENABLED=true");
    expect(
      validate({
        ...on,
        CLIENT_SESSION_ENABLED: "true",
        PAYMENTS_PILOT_ALLOWLIST: "42",
      }).stderr,
    ).toContain("UUID PAYMENTS_PILOT_ALLOWLIST");
  });

  it("refuses duplicated pilot keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "ii-tonya-pilot-dup-"));
    const file = join(dir, "runtime.env");
    writeFileSync(
      file,
      `${Object.entries({ ...base, ...pilot })
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")}\nPAYMENTS_PILOT_ALLOWLIST=99\n`,
    );
    const result = spawnSync(
      "bash",
      ["scripts/validate-runtime-env.sh", file, sha],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("at most once");
  });
});
