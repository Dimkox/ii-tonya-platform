export interface ExpertVerificationRepository {
  invoiceForManager(
    sessionHash: string,
    invoiceId: string,
  ): Promise<{
    id: string;
    operationId: string;
    status: "pending" | "settled" | "cancelled";
  } | null>;
  listQueue(sessionHash: string, limit?: number): Promise<readonly unknown[]>;
  applicationDetail(
    sessionHash: string,
    applicationId: string,
  ): Promise<unknown | null>;
  decide(input: {
    sessionHash: string;
    applicationId: string;
    decision: "approved" | "rejected";
    reasonCode: string;
    idempotencyKey: string;
  }): Promise<{
    applicationId: string;
    decision: "approved" | "rejected";
    invoiceId: string | null;
    replay: boolean;
  }>;
}
// Merchant confirmation pages may be hosted on yoomoney.ru; this is not the wallet API.
// https://yookassa.ru/developers/using-api/response-handling/http-codes
export interface ExpertVerificationCheckout {
  recoverCheckout(input: {
    invoiceId: string;
    operationId: string;
  }): Promise<
    | { kind: "ready"; url: string; paymentId: string }
    | { kind: "pending" | "unavailable" }
  >;
  createCheckout(input: {
    invoiceId: string;
  }): Promise<{ url: string; paymentId: string }>;
}
type Failure = {
  kind: "disabled" | "forbidden" | "invalid" | "unavailable" | "not_found";
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const validSession = (s: string) => /^sha256:[0-9a-f]{64}$/u.test(s);
const safeFailure = (e: unknown): Failure => ({
  kind:
    e instanceof Error && e.message === "verification_forbidden"
      ? "forbidden"
      : "unavailable",
});
export function createExpertVerificationService(deps: {
  enabled: boolean;
  repository: ExpertVerificationRepository;
  checkout?: ExpertVerificationCheckout;
}) {
  const authorize = (sessionHash: string): Failure | undefined =>
    !deps.enabled
      ? { kind: "disabled" }
      : !validSession(sessionHash)
        ? { kind: "forbidden" }
        : undefined;
  return {
    async list(sessionHash: string, input: { limit?: number }) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      const limit = input.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
        return { kind: "invalid" } as const;
      try {
        return {
          kind: "ok" as const,
          items: await deps.repository.listQueue(sessionHash, limit),
        };
      } catch (e) {
        return safeFailure(e);
      }
    },
    async detail(sessionHash: string, applicationId: string) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      if (!uuid.test(applicationId)) return { kind: "invalid" } as const;
      try {
        const item = await deps.repository.applicationDetail(
          sessionHash,
          applicationId,
        );
        return item
          ? { kind: "ok" as const, item }
          : { kind: "not_found" as const };
      } catch (e) {
        return safeFailure(e);
      }
    },
    async checkout(sessionHash: string, invoiceId: string) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      if (!uuid.test(invoiceId)) return { kind: "invalid" } as const;
      try {
        const invoice = await deps.repository.invoiceForManager(
          sessionHash,
          invoiceId,
        );
        if (!invoice) return { kind: "not_found" } as const;
        if (invoice.status !== "pending")
          return { kind: "ok" as const, payment: { status: invoice.status } };
        if (!deps.checkout)
          return {
            kind: "ok" as const,
            payment: { status: "waiting_configuration" as const },
          };
        // Recovery owns the same durable operation and its exact-body/GET custody.
        // Never turn an unknown outcome into another initial POST from this service.
        const payment = await deps.checkout.recoverCheckout({
          invoiceId: invoice.id,
          operationId: invoice.operationId,
        });
        if (payment.kind !== "ready")
          return { kind: "ok" as const, payment: { status: payment.kind } };
        const url = new URL(payment.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port ||
          !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
            url.hostname,
          ) ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(payment.paymentId)
        )
          throw new Error("verification_checkout_unavailable");
        return {
          kind: "ok" as const,
          payment: {
            status: "ready" as const,
            url: url.toString(),
            paymentId: payment.paymentId,
          },
        };
      } catch (e) {
        return safeFailure(e);
      }
    },
    async decide(
      sessionHash: string,
      input: {
        applicationId: string;
        decision: "approved" | "rejected";
        reasonCode: string;
        idempotencyKey: string;
      },
    ) {
      const denied = authorize(sessionHash);
      if (denied) return denied;
      const keys = Object.keys(input).sort().join(",");
      if (
        keys !== "applicationId,decision,idempotencyKey,reasonCode" ||
        !uuid.test(input.applicationId) ||
        !["approved", "rejected"].includes(input.decision) ||
        !/^[a-z][a-z0-9_]{0,63}$/u.test(input.reasonCode) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)
      )
        return { kind: "invalid" } as const;
      // Snapshot trusted session and validated command before any asynchronous work.
      const command = {
        sessionHash,
        applicationId: input.applicationId,
        decision: input.decision,
        reasonCode: input.reasonCode,
        idempotencyKey: input.idempotencyKey,
      };
      try {
        const result = await deps.repository.decide(command);
        if (result.decision !== "approved" || !result.invoiceId)
          return { kind: "ok" as const, ...result };
        if (result.replay)
          return {
            kind: "ok" as const,
            ...result,
            payment: { status: "not_repeated" as const },
          };
        if (!deps.checkout)
          return {
            kind: "ok" as const,
            ...result,
            payment: { status: "waiting_configuration" as const },
          };
        try {
          const payment = await deps.checkout.createCheckout({
            invoiceId: result.invoiceId,
          });
          const url = new URL(payment.url);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.port ||
            !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(
              url.hostname,
            ) ||
            !/^[A-Za-z0-9_-]{1,64}$/u.test(payment.paymentId)
          )
            throw new Error("verification_checkout_unavailable");
          return {
            kind: "ok" as const,
            ...result,
            payment: {
              status: "ready" as const,
              url: url.toString(),
              paymentId: payment.paymentId,
            },
          };
        } catch {
          return {
            kind: "ok" as const,
            ...result,
            payment: { status: "unavailable" as const },
          };
        }
      } catch (e) {
        return safeFailure(e);
      }
    },
  };
}
export type ExpertVerificationService = ReturnType<
  typeof createExpertVerificationService
>;
