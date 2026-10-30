import { ExperimentalGatewayIpc } from "@ii-tonya/integrations";
interface ReceiptRetentionRepository {
  listExpiredBatch(limit: number): Promise<{ id: string; userId: string }[]>;
  redactExpiredSelection(
    plan: readonly { id: string; userId: string }[],
  ): Promise<number>;
}
/** Revocation precedes deletion of exactly the rows observed, which are rechecked in DB. */
export function composeReceiptRetention(
  repository: ReceiptRetentionRepository,
  options: { checkoutEnabled: boolean; gateway?: ExperimentalGatewayIpc },
): () => Promise<number> {
  if (
    options.gateway !== undefined &&
    !(options.gateway instanceof ExperimentalGatewayIpc)
  )
    throw new Error("receipt_disclosure_gateway_invalid");
  if (options.checkoutEnabled && !options.gateway)
    throw new Error("receipt disclosure cancellation gateway required");
  return async () => {
    const plan = await repository.listExpiredBatch(100);
    if (plan.length === 0) return 0;
    if (options.checkoutEnabled)
      for (const contactId of new Set(plan.map((row) => row.id)))
        await options.gateway!.revokeContact(contactId);
    return repository.redactExpiredSelection(plan);
  };
}
/** Explicit opt-in adapter for a separately provisioned wave receipt repository. */
export function adaptEarlyBirdReceiptRetention(repository: {
  listExpired(limit: number): Promise<{ id: string; userId: string }[]>;
  expireSelected(row: { id: string; userId: string }): Promise<boolean>;
}): ReceiptRetentionRepository {
  return {
    listExpiredBatch: (limit) => repository.listExpired(limit),
    redactExpiredSelection: async (plan) => {
      let removed = 0;
      for (const row of plan)
        if (await repository.expireSelected(row)) removed++;
      return removed;
    },
  };
}
