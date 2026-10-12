export interface CampaignTariff {
  tariffVersionId: string;
  displayName: string;
  baseMonthlyMinor: string;
  currency: "RUB";
}
export interface CampaignQuote extends CampaignTariff {
  id: string;
  userId: string;
  termMonths: 1 | 3;
  monthlyPriceMinor: string;
  priceMinor: string;
  expiresAt: string;
  energyDiscountBps: number;
  startDiscountBps: number;
  floorApplied: boolean;
}
export interface CampaignCheckout {
  id: string;
  status:
    | "quoted"
    | "payment_pending"
    | "settled"
    | "failed"
    | "expired"
    | "refunded"
    | "charged_back";
  checkoutUrl?: string;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    v,
  );
const minor = (v: unknown): v is string =>
  typeof v === "string" && /^(?:0|[1-9][0-9]{0,18})$/u.exec(v)?.[0] === v;
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 512;
const integer = (v: unknown, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const instant = (v: unknown): v is string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
function validTariff(
  v: unknown,
): v is CampaignTariff & Record<string, unknown> {
  return (
    object(v) &&
    uuid(v.tariffVersionId) &&
    text(v.displayName) &&
    minor(v.baseMonthlyMinor) &&
    v.currency === "RUB"
  );
}
function validBenefits(v: Record<string, unknown>) {
  return (
    integer(v.durationSeconds, Number.MAX_SAFE_INTEGER) &&
    (v.durationSeconds as number) > 0 &&
    integer(v.creditCapBps, 10000) &&
    typeof v.individualServicesEnabled === "boolean" &&
    integer(v.groupEventLimit, Number.MAX_SAFE_INTEGER) &&
    (v.statisticsLevel === "basic" || v.statisticsLevel === "expanded") &&
    (v.supportPriority === "standard" || v.supportPriority === "priority")
  );
}
function malformed(): never {
  throw new Error("campaign_invalid_response");
}
export function campaignMoney(value: string): string {
  const amount = BigInt(value);
  return `${amount / 100n},${(amount % 100n).toString().padStart(2, "0")}`;
}
function checkoutUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^https:\/\//iu.test(value) ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\u0000-\u0020\u007f\\]/u.test(value)
  )
    return malformed();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return malformed();
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  )
    return malformed();
  return parsed.href;
}

export class ExpertCampaignClient {
  private active = true;
  private readonly pending = new Set<AbortController>();
  constructor(
    private readonly csrf: string,
    private readonly request: typeof fetch = (...args) => fetch(...args),
  ) {}
  dispose(): void {
    this.active = false;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
  private async call(path: string, body?: unknown): Promise<unknown> {
    if (!this.active) throw new Error("stale_response");
    const controller = new AbortController();
    this.pending.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.request(
            `/v1/expert/browser/residency/${path}`,
            {
              method: body === undefined ? "GET" : "POST",
              credentials: "same-origin",
              cache: "no-store",
              redirect: "error",
              signal: controller.signal,
              headers:
                body === undefined
                  ? {}
                  : {
                      "content-type": "application/json",
                      "x-csrf-token": this.csrf,
                    },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            },
          );
          if (!this.active) throw new Error("stale_response");
          if (!response.ok)
            throw new Error(
              response.status === 401 || response.status === 403
                ? "campaign_unauthorized"
                : response.status === 400 || response.status === 409
                  ? "campaign_rejected"
                  : "campaign_unavailable",
            );
          // Keep both body reading and JSON decoding within the request deadline.
          const reader = response.body?.getReader();
          if (!reader) return malformed();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              length += chunk.value.length;
              if (length > 65536) return malformed();
              chunks.push(chunk.value);
            }
          } finally {
            void reader.cancel().catch(() => undefined);
          }
          if (!this.active || controller.signal.aborted)
            throw new Error("stale_response");
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          try {
            return JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            ) as unknown;
          } catch {
            return malformed();
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("campaign_unavailable"));
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.pending.delete(controller);
    }
  }
  async tariffs(): Promise<CampaignTariff[]> {
    const result = await this.call("tariffs");
    if (
      !Array.isArray(result) ||
      result.length > 20 ||
      !result.every(
        (v) =>
          validTariff(v) &&
          validBenefits(v) &&
          v.priceKind === "base" &&
          v.commercialPolicyVersion === "expert_residency_v2",
      ) ||
      new Set(result.map((v) => (v as CampaignTariff).tariffVersionId)).size !==
        result.length
    )
      return malformed();
    return result as CampaignTariff[];
  }
  async quote(
    input: {
      tariffVersionId: string;
      termMonths: 1 | 3;
      idempotencyKey: string;
    },
    userId: string,
  ): Promise<CampaignQuote> {
    const v = await this.call("quotes", input);
    if (
      !validTariff(v) ||
      !validBenefits(v) ||
      !uuid(v.id) ||
      v.userId !== userId ||
      !uuid(v.userId) ||
      v.tariffVersionId !== input.tariffVersionId ||
      v.termMonths !== input.termMonths ||
      v.ruleVersion !== "expert_energy_start_v1" ||
      !minor(v.discountedMonthlyMinor) ||
      !minor(v.monthlyPriceMinor) ||
      !minor(v.priceMinor) ||
      !instant(v.calculationTimestamp) ||
      !instant(v.quotedAt) ||
      !instant(v.expiresAt) ||
      Date.parse(v.expiresAt) <= Date.parse(v.quotedAt) ||
      !integer(v.energyDiscountBps, 10000) ||
      !integer(v.startDiscountBps, 10000) ||
      typeof v.floorApplied !== "boolean"
    )
      return malformed();
    return v as unknown as CampaignQuote;
  }
  async checkout(input: {
    quoteId: string;
    idempotencyKey: string;
  }): Promise<CampaignCheckout> {
    const v = await this.call("checkouts", input);
    if (
      !object(v) ||
      !uuid(v.id) ||
      ![
        "quoted",
        "payment_pending",
        "settled",
        "failed",
        "expired",
        "refunded",
        "charged_back",
      ].includes(String(v.status))
    )
      return malformed();
    let url: string | undefined;
    if (v.status === "payment_pending") {
      if (
        !object(v.payment) ||
        v.payment.kind !== "created" ||
        !text(v.payment.paymentId)
      )
        return malformed();
      url = checkoutUrl(v.payment.checkoutUrl);
    } else if (v.payment !== undefined) return malformed();
    return {
      id: v.id,
      status: v.status as CampaignCheckout["status"],
      ...(url ? { checkoutUrl: url } : {}),
    };
  }
}
