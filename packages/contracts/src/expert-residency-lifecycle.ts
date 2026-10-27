/** Database-derived calendar lifecycle; paid order intervals remain authoritative. */
export interface ResidencyOwnerScope {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
}
export interface ResidencyOwnerEvent extends ResidencyOwnerScope {
  requestKey: string;
  requestDigest: string;
}
export interface ResidencyRenewalBill {
  readiness: "ready" | "requires_card";
  id: string;
  cycleEnd: string;
  tariffVersionId: string;
  termMonths: 1 | 3;
  quoteId: string | null;
  quote: {
    id: string;
    priceMinor: string;
    currency: "RUB";
    termMonths: 1 | 3;
    expiresAt: string;
  } | null;
  acceptanceId: string | null;
  orderId: string | null;
}
export interface ResidencyLifecycle {
  revision: number;
  status: "active" | "paused" | "payment_required";
  paidUntil: string | null;
  pausedUntil: string | null;
  bill: ResidencyRenewalBill | null;
}
export interface ResidencyLifecycleRepository {
  readLifecycle(scope: ResidencyOwnerScope): Promise<ResidencyLifecycle | null>;
  requestPause(
    event: ResidencyOwnerEvent & { returnDate: string },
  ): Promise<ResidencyLifecycle & { replay: boolean }>;
  resume(
    event: ResidencyOwnerEvent,
  ): Promise<ResidencyLifecycle & { replay: boolean }>;
  processLifecycleBatch(
    limit: number,
    options?: { signal?: AbortSignal },
  ): Promise<{
    examined: number;
    billsCreated: number;
    noticesCreated: number;
    suspended: number;
    resumed: number;
  }>;
  listDueNotices(limit: number): Promise<readonly { noticeId: string }[]>;
  deliverNotice(
    noticeId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{
    kind:
      | "delivered"
      | "already_delivered"
      | "unknown_outcome"
      | "cancelled"
      | "unavailable"
      | "waiting_content";
  }>;
}
