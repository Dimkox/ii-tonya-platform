export type TestExpertReconciliationMetric = {
  readonly name:
    | "reconciliation_age"
    | "units_consumed"
    | "units_released"
    | "unknown_outcome";
  readonly value: number;
};

export async function reconcileTestExpertTrial(input: {
  readonly limit: number;
  readonly minimumAgeMs: number;
  readonly now: Date;
  readonly repository: {
    scan(input: {
      limit: number;
      before: Date;
    }): Promise<readonly { reservationId: string; createdAt: Date }[]>;
    reconcile(
      reservationId: string,
    ): Promise<"applied" | "not_applied" | "unknown">;
  };
  readonly metrics: { record(event: TestExpertReconciliationMetric): void };
}): Promise<{
  scanned: number;
  applied: number;
  released: number;
  unknown: number;
}> {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    !Number.isInteger(input.minimumAgeMs) ||
    input.minimumAgeMs < 60_000 ||
    !Number.isFinite(input.now.getTime())
  )
    throw new Error("test_expert_reconciliation_bounds_invalid");
  const rows = await input.repository.scan({
    limit: input.limit,
    before: new Date(input.now.getTime() - input.minimumAgeMs),
  });
  let applied = 0;
  let released = 0;
  let unknown = 0;
  for (const row of rows.slice(0, input.limit)) {
    input.metrics.record({
      name: "reconciliation_age",
      value: Math.max(0, input.now.getTime() - row.createdAt.getTime()),
    });
    const outcome = await input.repository.reconcile(row.reservationId);
    if (outcome === "applied") {
      applied += 1;
      input.metrics.record({ name: "units_consumed", value: 1 });
    } else if (outcome === "not_applied") {
      released += 1;
      input.metrics.record({ name: "units_released", value: 1 });
    } else {
      unknown += 1;
      input.metrics.record({ name: "unknown_outcome", value: 1 });
    }
  }
  return { scanned: rows.length, applied, released, unknown };
}
