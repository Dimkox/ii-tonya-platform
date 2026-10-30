import type { YooKassaPayment, YooKassaRefund } from "./contracts.js";
import type { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
import type { PublicExpertPaymentSnapshot } from "./public-expert-gateway-contracts.js";

export interface PublicExpertListWindow {
  readonly createdFrom: string;
  readonly createdTo: string;
  readonly maxPages?: number;
}
export type PublicExpertCompleteList<T> =
  | { readonly complete: true; readonly items: readonly T[] }
  | { readonly complete: false; readonly items: readonly [] };

/** Credentialless transport. Discovery never authorizes a POST or brands settlement facts. */
export class PublicExpertGatewayTransport {
  constructor(
    private readonly ipc: Pick<
      ExperimentalGatewayIpc,
      "dispatchPublic" | "getPayment" | "getRefund" | "listPublicPage"
    >,
  ) {}

  dispatch(snapshot: PublicExpertPaymentSnapshot, exactBody: Uint8Array) {
    return this.ipc.dispatchPublic(snapshot, exactBody);
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
    const maxPages = input.maxPages ?? 10;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10)
      return { complete: false, items: [] };
    const items: (YooKassaPayment | YooKassaRefund)[] = [],
      ids = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined;
    try {
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const page = await this.ipc.listPublicPage(resource, {
          createdFrom: input.createdFrom,
          createdTo: input.createdTo,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const item of page.items) {
          const time = Date.parse(item.createdAt);
          if (
            ids.has(item.id) ||
            time < Date.parse(input.createdFrom) ||
            time >= Date.parse(input.createdTo)
          )
            return { complete: false, items: [] };
          ids.add(item.id);
          items.push(item);
        }
        if (page.nextCursor === undefined) return { complete: true, items };
        if (page.items.length === 0 || cursors.has(page.nextCursor))
          return { complete: false, items: [] };
        cursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    } catch {
      /* Incomplete/error discovery supplies no binding proof. */
    }
    return { complete: false, items: [] };
  }
}
