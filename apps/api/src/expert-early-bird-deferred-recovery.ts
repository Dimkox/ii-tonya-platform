import {
  type DeferredReceiptScope,
  type PostgresDeferredBoundReader,
  type PostgresDeferredScopeSource,
} from "@ii-tonya/db";
import { type YooKassaDeferredVerifier } from "@ii-tonya/integrations";
import type { EarlyBirdDeferredCheckoutSender } from "@ii-tonya/integrations";
type Client = ConstructorParameters<
  typeof EarlyBirdDeferredCheckoutSender
>[0]["client"];
type Discovery = {
  source: {
    read(
      scope: DeferredReceiptScope,
      invoiceId: string,
      userId: string,
    ): Promise<
      | { kind: "unavailable" | "not_dispatched" }
      | { kind: "unknown"; createdFrom: string; createdBefore: string }
    >;
  };
  listPayments(input: {
    createdFrom: string;
    createdTo: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    items: readonly {
      id: string;
      createdAt: string;
      test: boolean;
      metadata: { operation_id?: string; order_id?: string };
    }[];
    nextCursor?: string;
  }>;
  bind(
    proof: Awaited<ReturnType<YooKassaDeferredVerifier["verify"]>>,
  ): Promise<void>;
};
/** Recovery is a read-only fresh provider check; returning a URL does not authorize message delivery. */
export class EarlyBirdDeferredRecovery {
  constructor(
    private readonly scope: PostgresDeferredScopeSource,
    private readonly bound: PostgresDeferredBoundReader,
    private readonly verifier: YooKassaDeferredVerifier,
    private readonly client: Client,
    private readonly discovery?: Discovery,
  ) {}
  async find(
    scope: DeferredReceiptScope,
    invoiceId: string,
  ): Promise<
    | null
    | { kind: "unavailable" }
    | { kind: "reconcile"; invoiceId: string }
    | { kind: "bound"; invoiceId: string; paymentId: string }
    | {
        kind: "ready";
        invoiceId: string;
        paymentId: string;
        confirmationUrl: string;
      }
  > {
    const identity = await this.scope.resolve(scope);
    if (!identity) return { kind: "unavailable" };
    let binding = await this.bound.find(invoiceId);
    if (binding && binding.userId !== identity.userId)
      return { kind: "unavailable" };
    let window: { createdFrom: string; createdBefore: string } | undefined;
    let discovered = false;
    try {
      if (!binding) {
        if (!this.discovery) return { kind: "reconcile", invoiceId };
        const source = await this.discovery.source.read(
          scope,
          invoiceId,
          identity.userId,
        );
        if (source.kind === "unavailable") return { kind: "unavailable" };
        if (source.kind === "not_dispatched") return null;
        if (source.kind !== "unknown")
          throw new Error("early_bird_deferred_recovery_mismatch");
        window = source;
        const from = Date.parse(source.createdFrom),
          before = Date.parse(source.createdBefore);
        if (
          !Number.isFinite(from) ||
          !Number.isFinite(before) ||
          before <= from ||
          before - from > 86400000
        )
          throw new Error("early_bird_deferred_recovery_mismatch");
        const candidates = new Set<string>(),
          cursors = new Set<string>();
        let cursor: string | undefined,
          complete = false;
        for (let page = 0; page < 3; page++) {
          const result = await this.discovery.listPayments({
            createdFrom: source.createdFrom,
            createdTo: source.createdBefore,
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          if (!Array.isArray(result.items) || result.items.length > 100)
            throw new Error("early_bird_deferred_recovery_mismatch");
          for (const p of result.items) {
            if (
              p.metadata?.order_id !== invoiceId &&
              p.metadata?.operation_id !== invoiceId
            )
              continue;
            const created = Date.parse(p.createdAt);
            if (
              !/^[A-Za-z0-9_-]{1,64}$/u.test(p.id) ||
              p.test !== false ||
              !Number.isFinite(created) ||
              created < from ||
              created >= before ||
              p.metadata.order_id !== invoiceId ||
              p.metadata.operation_id !== invoiceId
            )
              throw new Error("early_bird_deferred_recovery_mismatch");
            candidates.add(p.id);
            if (candidates.size > 1)
              throw new Error("early_bird_deferred_recovery_mismatch");
          }
          if (result.nextCursor === undefined) {
            complete = true;
            break;
          }
          if (
            !/^[\x21-\x7e]{1,1024}$/u.test(result.nextCursor) ||
            cursors.has(result.nextCursor)
          )
            throw new Error("early_bird_deferred_recovery_mismatch");
          cursor = result.nextCursor;
          cursors.add(cursor);
        }
        if (!complete || candidates.size !== 1)
          return { kind: "reconcile", invoiceId };
        binding = {
          invoiceId,
          userId: identity.userId,
          providerId: [...candidates][0]!,
        };
        discovered = true;
      }
      const proof = await this.verifier.verify(invoiceId, binding.providerId);
      if (
        proof.userId !== identity.userId ||
        proof.providerId !== binding.providerId
      )
        throw new Error("early_bird_deferred_recovery_mismatch");
      const p = await this.client.getPayment(binding.providerId);
      const amount = /^(0|[1-9]\d*)\.(\d{2})$/u.exec(p.amount.value);
      if (
        !amount ||
        BigInt(amount[1]!) * 100n + BigInt(amount[2]!) !==
          BigInt(proof.amountMinor) ||
        (window &&
          (!Number.isFinite(Date.parse(p.createdAt)) ||
            Date.parse(p.createdAt) < Date.parse(window.createdFrom) ||
            Date.parse(p.createdAt) >= Date.parse(window.createdBefore))) ||
        p.id !== proof.providerId ||
        p.test !== (proof.mode === "test") ||
        p.amount.currency !== "RUB" ||
        p.metadata?.order_id !== proof.invoiceId ||
        p.metadata?.operation_id !== proof.operationId ||
        p.metadata?.user_id !== proof.userId ||
        p.metadata?.purpose !== "early_bird_deferred" ||
        p.metadata?.stage !== proof.stage ||
        p.metadata?.pricing_policy !== proof.policy ||
        (proof.grantId
          ? p.metadata?.pricing_grant_id !== proof.grantId
          : p.metadata?.pricing_grant_id !== undefined)
      )
        throw new Error("early_bird_deferred_recovery_mismatch");
      if (discovered) await this.discovery!.bind(proof);
      if (p.status !== "pending" || p.paid !== false || !p.confirmation)
        return { kind: "bound", invoiceId, paymentId: binding.providerId };
      const url = new URL(p.confirmation.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "yoomoney.ru" ||
        url.port !== "" ||
        url.username ||
        url.password ||
        url.hash ||
        url.href.length > 2048
      )
        throw new Error("early_bird_deferred_recovery_mismatch");
      return {
        kind: "ready",
        invoiceId,
        paymentId: binding.providerId,
        confirmationUrl: url.href,
      };
    } catch {
      return { kind: "reconcile", invoiceId };
    }
  }
}
