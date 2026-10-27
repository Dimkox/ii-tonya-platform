export type ClientBotAccountQuery =
  | { kind: "coupons" }
  | { kind: "orders"; after?: string }
  | { kind: "reservations"; after?: string };
export interface ClientBotAccountEvent {
  botId: string;
  botKey: string;
  telegramUserId: string;
  chatId: string;
  updateId: number;
  query: ClientBotAccountQuery;
}
export type ClientBotAccountProjection =
  | { kind: "duplicate" | "unavailable" }
  | {
      kind: "coupons";
      /** Unexpired issued face value in kopecks; not a spend ledger. */
      coupons_balance: string;
      asOf: string;
      details: readonly { amountMinor: string; expiresAt: string }[];
      hasMore: boolean;
    }
  | {
      kind: "orders";
      orders: readonly {
        handle: string;
        packageCode: string;
        priceMinor: string;
        currency: "RUB";
        createdAt: string;
        state: "paid" | "unsettled";
      }[];
      nextCursor: string | null;
    }
  | {
      kind: "reservations";
      bookings: readonly {
        bookingHandle: string;
        state: string;
        startsAt: string;
        reservedUntil: string | null;
      }[];
      nextCursor: string | null;
    };
export interface ClientBotAccountReadRepository {
  read(event: ClientBotAccountEvent): Promise<ClientBotAccountProjection>;
}
