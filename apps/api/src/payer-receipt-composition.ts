import { createPayerReceiptCaptureService } from "@ii-tonya/application";
import {
  PostgresPayerReceiptContactRepository,
  PostgresExpertCampaignReadRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createPayerReceiptVault,
  resolvePayerReceiptKeys,
  createPayerReceiptSource,
} from "@ii-tonya/integrations";
import type { RuntimeConfig } from "@ii-tonya/config";

export function createPayerReceiptComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const settings = config.payerReceipt;
  const raw = environment.PAYER_RECEIPT_KEYS_JSON;
  // Validate supplied material even if capture is disabled; missing material is unavailable.
  const keys = raw ? resolvePayerReceiptKeys(raw) : undefined;
  if (!settings || !keys) return undefined;
  const vault = createPayerReceiptVault({
    activeKeyId: settings.activeKeyId,
    keys,
  });
  const repository = new PostgresPayerReceiptContactRepository(
    db,
    vault,
    settings.retentionDays,
  );
  const reads = new PostgresExpertCampaignReadRepository(
    db,
    config.expertSession?.botKey ?? "",
  );
  return {
    vault,
    service: createPayerReceiptCaptureService({
      ownerUserId: (id) => reads.ownerUserId(id),
      capture: (input) => repository.capture(input),
    }),
    source: createPayerReceiptSource(repository),
  };
}
