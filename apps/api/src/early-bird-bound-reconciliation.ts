import { sql } from "drizzle-orm";
import type { DrizzleDb } from "@ii-tonya/db";
import type {
  YooKassaEarlyBirdVerifier,
  YooKassaDeferredVerifier,
} from "@ii-tonya/integrations";
export type BoundReconciliationRow = {
  key: string;
  product: "composite" | "deferred";
  invoiceId: string;
  userId: string;
  providerId: string;
  ambiguous: boolean;
};
/** Trusted API primary connection. Discovery is SELECT-only; only separately
 * verified proofs held by isolated settlement stores can change financial facts. */
export class PostgresEarlyBirdBoundReconciliationSource {
  constructor(private readonly db: DrizzleDb) {}
  async list(
    after: string | undefined,
    limit: number,
  ): Promise<BoundReconciliationRow[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10)
      throw new Error("early_bird_bound_reconciliation_limit");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout='5000ms'`);
      await tx.execute(sql`set local lock_timeout='1000ms'`);
      return (
        await tx.execute<BoundReconciliationRow>(sql`
   with bindings as (
    select 'composite/'||i.invoice_id::text as key,'composite'::text as product,i.invoice_id::text as "invoiceId",i.user_id::text as "userId",b.provider_object_id as "providerId"
    from early_bird_verified_bindings b join early_bird_composite_intents i on i.id=b.intent_id and i.user_id=b.user_id join users u on u.id=i.user_id and u.active
    where i.status='unknown' and not exists(select 1 from early_bird_payment_successes s where s.intent_id=i.id) and not exists(select 1 from expert_sales_erased_cohorts e where e.user_id=i.user_id)
    union all
    select 'deferred/'||i.id::text,'deferred',i.id::text,i.user_id::text,b.provider_id
    from early_bird_deferred_verified_bindings b join early_bird_deferred_invoices i on i.id=b.invoice_id and i.user_id=b.user_id join users u on u.id=i.user_id and u.active
    where i.captured_at is null and i.dispatch_started_at is not null and not exists(select 1 from expert_sales_erased_cohorts e where e.user_id=i.user_id)
   )
   select b.*, (
    (select count(*) from early_bird_verified_bindings x where x.provider_object_id=b."providerId")+
    (select count(*) from early_bird_deferred_verified_bindings x where x.provider_id=b."providerId")+
    (select count(*) from expert_onboarding_payment_operations x where x.provider_object_id=b."providerId")+
    (select count(*) from expert_residency_provider_operations x where x.provider='yookassa' and x.operation_kind='create_payment' and x.provider_object_id=b."providerId")<>1
   ) as ambiguous from bindings b where (${after ?? null}::text is null or b.key>${after ?? null}) order by b.key limit ${limit}
  `)
      ).rows;
    });
  }
}
/** One in-flight cycle, bounded discovery and provider work. No checkout/POST
 * capability exists here. Cursor rotation prevents a poison record starving peers. */
export class EarlyBirdBoundReconciliation {
  private accepting = false;
  private stopped = false;
  private cursor: string | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running:
    | Promise<{ kind: "completed"; examined: number; failed: number }>
    | undefined;
  constructor(
    private readonly source: {
      list(
        after: string | undefined,
        limit: number,
      ): Promise<readonly BoundReconciliationRow[]>;
    },
    private readonly reconcile: (
      row: BoundReconciliationRow,
      canCommit: () => boolean,
    ) => Promise<void>,
    private readonly intervalMs = 60000,
  ) {
    if (
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 1000 ||
      intervalMs > 3600000
    )
      throw new Error("early_bird_bound_reconciliation_interval");
  }
  start() {
    if (this.stopped || this.accepting) return;
    this.accepting = true;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref();
    void this.runOnce().catch(() => undefined);
  }
  async runOnce(): Promise<
    | { kind: "stopped" | "overlap" }
    | { kind: "completed"; examined: number; failed: number }
  > {
    if (!this.accepting) return { kind: "stopped" };
    if (this.running) return { kind: "overlap" };
    const work = this.cycle();
    this.running = work;
    try {
      return await work;
    } finally {
      if (this.running === work) this.running = undefined;
    }
  }
  private async cycle() {
    let examined = 0,
      failed = 0;
    const deadline = Date.now() + 30000;
    let rows = await this.source.list(this.cursor, 10);
    if (rows.length === 0 && this.cursor !== undefined) {
      this.cursor = undefined;
      rows = await this.source.list(undefined, 10);
    }
    for (const row of rows.slice(0, 10)) {
      if (!this.accepting || Date.now() >= deadline) break;
      this.cursor = row.key;
      examined++;
      if (
        row.ambiguous ||
        !["composite", "deferred"].includes(row.product) ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(row.providerId)
      ) {
        failed++;
        continue;
      }
      try {
        await this.reconcile(
          row,
          () => this.accepting && Date.now() < deadline,
        );
      } catch {
        failed++;
      }
    }
    return { kind: "completed" as const, examined, failed };
  }
  async stop() {
    this.stopped = true;
    this.accepting = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    const work = this.running;
    if (!work) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work.catch(() => undefined),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error("early_bird_bound_reconciliation_drain_timeout"),
              ),
            25000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

/** Shares the exact verifier issuers and restricted stores used by callbacks. */
export function createEarlyBirdBoundPaymentReconciler(input: {
  compositeVerifier: Pick<YooKassaEarlyBirdVerifier, "verify">;
  compositeStore: { commit(proof: unknown): Promise<void> };
  deferredVerifier: Pick<YooKassaDeferredVerifier, "verify">;
  deferredStore: { commit(proof: unknown): Promise<void> };
}) {
  return async (row: BoundReconciliationRow, canCommit: () => boolean) => {
    if (row.ambiguous)
      throw new Error("early_bird_bound_reconciliation_ambiguous");
    if (row.product === "composite") {
      const proof = await input.compositeVerifier.verify(row.invoiceId);
      if (!proof) return;
      if (
        proof.invoiceId !== row.invoiceId ||
        proof.userId !== row.userId ||
        proof.providerObjectId !== row.providerId
      )
        throw new Error("early_bird_bound_reconciliation_mismatch");
      if (canCommit()) await input.compositeStore.commit(proof);
    } else {
      const proof = await input.deferredVerifier.verify(
        row.invoiceId,
        row.providerId,
      );
      if (
        proof.invoiceId !== row.invoiceId ||
        proof.userId !== row.userId ||
        proof.providerId !== row.providerId
      )
        throw new Error("early_bird_bound_reconciliation_mismatch");
      if (proof.status === "succeeded" && canCommit())
        await input.deferredStore.commit(proof);
    }
  };
}
