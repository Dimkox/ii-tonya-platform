import { expect, it } from "vitest";
import { loadEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://local:local@localhost/test",
  ALLOW_INSECURE_LOCAL_DATABASE: "true",
};
const enabled = {
  ...base,
  PAYER_RECEIPT_CAPTURE_ENABLED: "true",
  PAYER_RECEIPT_ACTIVE_KEY_ID: "r1",
  PAYER_RECEIPT_KEYRING_REF: "env://PAYER_RECEIPT_KEYS_JSON",
  PAYER_RECEIPT_RETENTION_DAYS: "30",
};
it("retains only dedicated reference, active id and explicit retention", () => {
  expect(loadEnv(enabled)).toHaveProperty("payerReceipt", {
    activeKeyId: "r1",
    keyringRef: "env://PAYER_RECEIPT_KEYS_JSON",
    retentionDays: 30,
  });
});
it("missing configuration disables capture without a retention default", () => {
  for (const key of [
    "PAYER_RECEIPT_RETENTION_DAYS",
    "PAYER_RECEIPT_ACTIVE_KEY_ID",
    "PAYER_RECEIPT_KEYRING_REF",
  ]) {
    const input: NodeJS.ProcessEnv = { ...enabled };
    delete input[key];
    expect(loadEnv(input)).not.toHaveProperty("payerReceipt");
  }
  expect(loadEnv(base)).not.toHaveProperty("payerReceipt");
});
it.each(["0", "401", "1.5", "30\n", "NaN", "-1"])(
  "rejects malformed retention %j without reflecting input",
  (days) => {
    expect(() =>
      loadEnv({ ...enabled, PAYER_RECEIPT_RETENTION_DAYS: days }),
    ).toThrow("payer_receipt_configuration_invalid");
  },
);
it("rejects use of a merchant key reference", () => {
  expect(() =>
    loadEnv({
      ...enabled,
      PAYER_RECEIPT_KEYRING_REF: "env://YOOKASSA_SECRET_KEY",
    }),
  ).toThrow("payer_receipt_configuration_invalid");
});
