import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
/** Retries only idempotent revocation, never a provider payment request. */
export function composeReceiptRevocationRecovery(
  repository: {
    listPending(
      version: string,
      limit: number,
    ): Promise<{ token: string; contactId: string }[]>;
    acknowledge(token: string, version: string): Promise<void>;
  },
  gateway: ExperimentalGatewayIpc,
  keyVersion: string,
): () => Promise<number> {
  if (
    !(gateway instanceof ExperimentalGatewayIpc) ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(keyVersion)
  )
    throw new Error("receipt_revocation_recovery_invalid");
  return async () => {
    const tokens = await repository.listPending(keyVersion, 100);
    let count = 0;
    for (const { token, contactId } of tokens) {
      await gateway.revokeContactToken(token, contactId);
      await repository.acknowledge(token, keyVersion);
      count++;
    }
    return count;
  };
}
