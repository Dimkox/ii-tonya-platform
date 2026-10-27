import type { RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresHeldOnboardingCheckout,
  PostgresExpertVerificationRepository,
  PostgresExpertSalesScheduler,
  type DrizzleDb,
  type SalesNoticeTransport,
} from "@ii-tonya/db";
export type HeldSalesCapabilities = Omit<
  ConstructorParameters<typeof PostgresHeldOnboardingCheckout>[1],
  "enabled" | "repository" | "mode"
>;
export function createSeparatedSalesRunner(
  db: DrizzleDb,
  config: RuntimeConfig,
  fetcher: typeof fetch = fetch,
  payment?: HeldSalesCapabilities,
) {
  if (config.features.expertSeparatedSales !== true) return undefined;
  const scope = config.expertApplicant!;
  const abort = new AbortController();
  let transport: SalesNoticeTransport | undefined;
  if (config.features.expertResidencyNoticeDelivery === true) {
    if (!scope.botToken || scope.botToken.split(":")[0] !== scope.botId)
      throw new Error("expert_sales_notice_configuration_required");
    transport = {
      async send(input) {
        if (input.botId !== scope.botId || input.botKey !== scope.botKey)
          throw new Error("expert_sales_notice_scope");
        const signal = AbortSignal.any([
          input.signal,
          AbortSignal.timeout(15000),
        ]);
        const response = await fetcher(
          `https://api.telegram.org/bot${scope.botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: input.chatId,
              text: input.text,
              protect_content: true,
            }),
            signal,
          },
        );
        const reader = response.body?.getReader();
        if (!reader) throw new Error("expert_sales_notice_receipt");
        const chunks: Uint8Array[] = [];
        let size = 0;
        let cancel = () => {};
        const aborted = new Promise<never>((_, reject) => {
          cancel = () => reject(new Error("expert_sales_notice_unavailable"));
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) cancel();
        });
        let raw: string;
        try {
          while (true) {
            const part = await Promise.race([reader.read(), aborted]);
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 262144) throw new Error("expert_sales_notice_receipt");
            chunks.push(part.value);
          }
          raw = new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          );
        } catch {
          throw new Error("expert_sales_notice_unavailable");
        } finally {
          signal.removeEventListener("abort", cancel);
          void reader.cancel().catch(() => {});
          try {
            reader.releaseLock();
          } catch {
            /* canceled pending read */
          }
        }
        let value: {
          ok?: boolean;
          result?: {
            message_id?: number;
            from?: { id?: number; is_bot?: boolean };
            chat?: { id?: number; type?: string };
          };
        };
        try {
          value = JSON.parse(raw) as typeof value;
        } catch {
          throw new Error("expert_sales_notice_receipt");
        }
        if (
          !response.ok ||
          value.ok !== true ||
          !Number.isSafeInteger(value.result?.message_id) ||
          value.result!.message_id! <= 0 ||
          String(value.result?.from?.id) !== input.botId ||
          value.result?.from?.is_bot !== true ||
          String(value.result?.chat?.id) !== input.chatId ||
          value.result?.chat?.type !== "private"
        )
          throw new Error("expert_sales_notice_receipt");
        return {
          botId: input.botId,
          chatId: input.chatId,
          messageId: String(value.result!.message_id),
          digest: input.digest,
        };
      },
    };
  }
  const settings = config.expertVerification;
  const held =
    config.features.expertHeldOnboarding === true && payment && settings
      ? new PostgresHeldOnboardingCheckout(db, {
          ...payment,
          enabled: true,
          mode: settings.paymentMode,
          repository: new PostgresExpertVerificationRepository(db, {
            providerMode: settings.paymentMode,
            messagingConsentPolicyVersion:
              settings.messagingConsentPolicyVersion,
          }),
        })
      : undefined;
  if (config.features.expertHeldOnboarding === true && !held)
    throw new Error("held_onboarding_worker_capability_required");
  const scheduler = new PostgresExpertSalesScheduler(db, transport, held);
  return {
    async runOnce() {
      if (abort.signal.aborted) return { stopped: true };
      await held?.reconcileKnown();
      return {
        ...(await scheduler.refresh()),
        ...(await scheduler.deliver(abort.signal)),
      };
    },
    stopAccepting() {
      abort.abort();
    },
  };
}
