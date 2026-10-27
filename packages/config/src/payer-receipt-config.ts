export interface PayerReceiptConfig {
  activeKeyId: string;
  keyringRef: "env://PAYER_RECEIPT_KEYS_JSON";
  retentionDays: number;
}
export function readPayerReceiptConfig(
  source: NodeJS.ProcessEnv,
): PayerReceiptConfig | undefined {
  const enabled = source.PAYER_RECEIPT_CAPTURE_ENABLED || "false";
  const id = source.PAYER_RECEIPT_ACTIVE_KEY_ID || undefined;
  const ref = source.PAYER_RECEIPT_KEYRING_REF || undefined;
  const days = source.PAYER_RECEIPT_RETENTION_DAYS || undefined;
  if (
    !["true", "false"].includes(enabled) ||
    (id !== undefined && /^[A-Za-z0-9_-]{1,64}$/u.exec(id)?.[0] !== id) ||
    (ref !== undefined && ref !== "env://PAYER_RECEIPT_KEYS_JSON") ||
    (days !== undefined &&
      (/^[1-9][0-9]{0,2}$/u.exec(days)?.[0] !== days || Number(days) > 400))
  )
    throw new Error("payer_receipt_configuration_invalid");
  if (enabled !== "true" || !id || !ref || !days) return undefined;
  return { activeKeyId: id, keyringRef: ref, retentionDays: Number(days) };
}
