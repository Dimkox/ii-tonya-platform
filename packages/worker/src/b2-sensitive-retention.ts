import type {
  B2SensitiveRetentionResult,
  PostgresB2SensitiveRetentionRepository,
} from "@ii-tonya/db";

export async function runB2SensitiveRetention(input: {
  readonly enabled: boolean;
  readonly repository: Pick<
    PostgresB2SensitiveRetentionRepository,
    "purgeExpired"
  >;
  readonly now: () => Date;
  readonly batchSize: number;
}): Promise<B2SensitiveRetentionResult> {
  if (!input.enabled)
    return { inboundPurged: 0, outboxRedacted: 0, proposalsRedacted: 0 };
  return input.repository.purgeExpired(input.now(), input.batchSize);
}
