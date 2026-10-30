import type { YooKassaPayment, YooKassaRefund } from "./contracts.js";
import type { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
import type { PublicExpertPaymentSnapshot } from "./public-expert-gateway-contracts.js";

export interface PublicExpertListWindow {
  readonly createdFrom: string;
  readonly createdTo: string;
  readonly maxPages?: number;
  readonly signal?: AbortSignal | undefined;
  readonly scanKey?: string;
}
export type PublicExpertCompleteList<T> =
  | { readonly complete: true; readonly items: readonly T[] }
  | { readonly complete: false; readonly items: readonly [] };

/** Credentialless transport. Discovery never authorizes a POST or brands settlement facts. */
export class PublicExpertGatewayTransport {
  private readonly scans = new Map<
    string,
    {
      signature: string;
      items: (YooKassaPayment | YooKassaRefund)[];
      ids: Set<string>;
      cursors: Set<string>;
      cursor: string | undefined;
      pages: number;
      completedAt: number | null;
    }
  >();
  private readonly scanning = new Map<
    string,
    Promise<PublicExpertCompleteList<YooKassaPayment | YooKassaRefund>>
  >();
  hasIncompleteScan(key: string) {
    // Includes complete discovery waiting for its mandatory fresh verification.
    return this.scans.has(key);
  }
  hasPendingVerification(key: string) {
    const completedAt = this.scans.get(key)?.completedAt;
    return (
      completedAt !== undefined &&
      completedAt !== null &&
      Date.now() >= completedAt &&
      Date.now() - completedAt < 120000
    );
  }
  forgetScan(key: string) {
    this.scans.delete(key);
  }
  constructor(
    private readonly ipc: Pick<
      ExperimentalGatewayIpc,
      "dispatchPublic" | "getPayment" | "getRefund" | "listPublicPage"
    >,
  ) {}

  dispatch(
    snapshot: PublicExpertPaymentSnapshot,
    exactBody: Uint8Array,
    signal?: AbortSignal,
  ) {
    return this.ipc.dispatchPublic(snapshot, exactBody, signal);
  }
  getPayment(id: string, signal?: AbortSignal) {
    return this.ipc.getPayment(id, signal);
  }
  getRefund(id: string, signal?: AbortSignal) {
    return this.ipc.getRefund(id, signal);
  }
  listPayments(
    input: PublicExpertListWindow,
  ): Promise<PublicExpertCompleteList<YooKassaPayment>> {
    return this.list("payments", input) as Promise<
      PublicExpertCompleteList<YooKassaPayment>
    >;
  }
  listRefunds(
    input: PublicExpertListWindow,
  ): Promise<PublicExpertCompleteList<YooKassaRefund>> {
    return this.list("refunds", input) as Promise<
      PublicExpertCompleteList<YooKassaRefund>
    >;
  }
  private async list(
    resource: "payments" | "refunds",
    input: PublicExpertListWindow,
  ): Promise<PublicExpertCompleteList<YooKassaPayment | YooKassaRefund>> {
    if (input.signal?.aborted) return { complete: false, items: [] };
    const key = input.scanKey;
    const prior = key ? this.scanning.get(key) : undefined;
    if (prior) return prior;
    const work = this.scan(resource, input);
    if (key) this.scanning.set(key, work);
    try {
      return await work;
    } finally {
      if (key && this.scanning.get(key) === work) this.scanning.delete(key);
    }
  }
  private async scan(
    resource: "payments" | "refunds",
    input: PublicExpertListWindow,
  ): Promise<PublicExpertCompleteList<YooKassaPayment | YooKassaRefund>> {
    const maxPages = input.maxPages ?? 10;
    if (
      input.signal?.aborted ||
      !Number.isInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 10
    )
      return { complete: false, items: [] };
    const key = input.scanKey,
      signature = JSON.stringify([
        resource,
        input.createdFrom,
        input.createdTo,
        maxPages,
      ]);
    const previous = key ? this.scans.get(key) : undefined;
    const scan =
      previous?.signature === signature &&
      (previous.completedAt === null || this.hasPendingVerification(key!))
        ? previous
        : {
            signature,
            items: [] as (YooKassaPayment | YooKassaRefund)[],
            ids: new Set<string>(),
            cursors: new Set<string>(),
            cursor: undefined as string | undefined,
            pages: 0,
            completedAt: null,
          };
    const forget = () => {
      if (key) this.scans.delete(key);
    };
    if (key) {
      if (this.scans.size >= 64 && !this.scans.has(key))
        this.scans.delete(this.scans.keys().next().value!);
      this.scans.set(key, scan);
    }
    // A completed traversal is still discovery-only. Retain it for at most two
    // minutes so the next bounded turn can GET afresh; never expose cached GET
    // facts or let callers mutate retained discovery through returned items.
    if (scan.completedAt !== null)
      return { complete: true, items: structuredClone(scan.items) };
    try {
      while (scan.pages < maxPages && !input.signal?.aborted) {
        const page = await this.ipc.listPublicPage(
          resource,
          {
            createdFrom: input.createdFrom,
            createdTo: input.createdTo,
            limit: 100,
            ...(scan.cursor === undefined ? {} : { cursor: scan.cursor }),
          },
          input.signal,
        );
        if (input.signal?.aborted) break;
        for (const item of page.items) {
          const time = Date.parse(item.createdAt);
          if (
            scan.ids.has(item.id) ||
            time < Date.parse(input.createdFrom) ||
            time >= Date.parse(input.createdTo)
          ) {
            forget();
            return { complete: false, items: [] };
          }
          scan.ids.add(item.id);
          scan.items.push(item);
        }
        scan.pages++;
        if (page.nextCursor === undefined) {
          scan.completedAt = Date.now();
          return { complete: true, items: structuredClone(scan.items) };
        }
        if (page.items.length === 0 || scan.cursors.has(page.nextCursor)) {
          forget();
          return { complete: false, items: [] };
        }
        scan.cursors.add(page.nextCursor);
        scan.cursor = page.nextCursor;
      }
    } catch {
      /* Incomplete/error discovery supplies no binding proof. */
    }
    // Keep completed pages only when a caller's bounded turn was cancelled.
    // No partial items escape; binding still requires complete traversal+GET.
    if (!input.signal?.aborted || scan.pages === 0 || scan.pages >= maxPages)
      forget();
    return { complete: false, items: [] };
  }
}
