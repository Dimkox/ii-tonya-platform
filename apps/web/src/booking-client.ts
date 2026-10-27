import { PrivacyClient } from "./privacy-client.js";

export interface BookingCard {
  displayName: string;
  serviceCode: string;
  language: string;
  availability: "catalog_only" | "fresh_slots";
  slots: { startsAt: string; choiceHandle?: string }[];
}
export interface ActiveBooking {
  bookingHandle: string;
  state:
    | "reserved"
    | "booked"
    | "calendar_pending"
    | "cancellation_pending"
    | "confirmation_unverified";
  startsAt: string;
  reservedUntil: string;
}
export interface BookingPage {
  bookings: ActiveBooking[];
  nextCursor: string | null;
}
const bk = /^bk1\.[A-Za-z0-9_-]{43}$/u;
const ch = /^ch1\.[A-Za-z0-9_-]{43}$/u;
const instant = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export class BookingClient {
  private disposed = false;
  private writing = false;
  private readonly epoch: number;
  private expectedCursor: string | null = null;
  private scanning = false;
  private stopDelay: (() => void) | undefined;
  needsReconciliation = false;
  constructor(private readonly session: PrivacyClient) {
    this.epoch = session.sessionEpoch;
  }
  dispose(): void {
    this.disposed = true;
    this.stopDelay?.();
  }
  private assertCurrent(): void {
    if (
      this.disposed ||
      this.session.sessionEpoch !== this.epoch ||
      !this.session.authenticated
    )
      throw new Error("stale_response");
  }
  private async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    this.assertCurrent();
    const value = await this.session.bookingRequest<T>(
      path,
      method,
      body,
      timeoutMs,
    );
    this.assertCurrent();
    return value;
  }
  async list(after?: string): Promise<BookingPage> {
    if (after !== undefined && !bk.test(after))
      throw new Error("invalid_booking_cursor");
    const page = await this.call<BookingPage>(
      `bookings${after === undefined ? "" : `?after=${after}`}`,
    );
    if (
      !Array.isArray(page.bookings) ||
      page.bookings.length > 20 ||
      (page.nextCursor !== null && !bk.test(page.nextCursor)) ||
      page.bookings.some(
        (row) =>
          !bk.test(row.bookingHandle) ||
          ![
            "reserved",
            "booked",
            "calendar_pending",
            "cancellation_pending",
            "confirmation_unverified",
          ].includes(row.state) ||
          !instant(row.startsAt) ||
          !instant(row.reservedUntil),
      )
    )
      throw new Error("invalid_booking_page");
    if (after === undefined) this.scanning = true;
    else if (after !== this.expectedCursor) this.scanning = false;
    this.expectedCursor = page.nextCursor;
    if (this.scanning && page.nextCursor === null)
      this.needsReconciliation = false;
    return page;
  }
  private async mutate<T = void>(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<T> {
    this.assertCurrent();
    if (this.writing) throw new Error("booking_busy");
    if (this.needsReconciliation)
      throw new Error("booking_reconciliation_required");
    this.writing = true;
    this.scanning = false;
    // A read must follow even a successful write; failures never auto-replay.
    this.needsReconciliation = true;
    try {
      return await this.call<T>(path, method, body);
    } finally {
      this.writing = false;
    }
  }
  reserve(choiceHandle: string): Promise<void> {
    if (!ch.test(choiceHandle))
      return Promise.reject(new Error("invalid_choice"));
    return this.mutate("bookings", "POST", { choiceHandle });
  }
  async cancel(
    bookingHandle: string,
  ): Promise<"cancelled" | "cancellation_pending"> {
    if (!bk.test(bookingHandle))
      return Promise.reject(new Error("invalid_booking"));
    const result = await this.mutate<{ bookingHandle: string; state: string }>(
      `bookings/${bookingHandle}`,
      "DELETE",
    );
    if (
      result.bookingHandle !== bookingHandle ||
      !["cancelled", "cancellation_pending"].includes(result.state)
    )
      throw new Error("invalid_cancellation_result");
    return result.state as "cancelled" | "cancellation_pending";
  }
  async catalog(filters: {
    serviceCode?: string;
    language?: string;
  }): Promise<BookingCard[]> {
    const deadline = Date.now() + 30000;
    const receipt = await this.call<{ catalogRequestId: string }>(
      "catalog-requests",
      "POST",
      filters,
      30000,
    );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        receipt.catalogRequestId,
      )
    )
      throw new Error("invalid_catalog");
    for (let attempt = 0; attempt < 10 && Date.now() < deadline; attempt++) {
      const value = await this.call<{ state: string; cards?: BookingCard[] }>(
        `catalog-requests/${receipt.catalogRequestId}`,
        "GET",
        undefined,
        deadline - Date.now(),
      );
      if (value.state === "ready") {
        if (
          !Array.isArray(value.cards) ||
          value.cards.some(
            (card) =>
              typeof card.displayName !== "string" ||
              typeof card.serviceCode !== "string" ||
              typeof card.language !== "string" ||
              !["catalog_only", "fresh_slots"].includes(card.availability) ||
              !Array.isArray(card.slots) ||
              card.slots.some(
                (slot) =>
                  !instant(slot.startsAt) ||
                  (slot.choiceHandle !== undefined &&
                    !ch.test(slot.choiceHandle)),
              ),
          )
        )
          throw new Error("invalid_catalog");
        return value.cards;
      }
      if (value.state !== "pending") throw new Error("invalid_catalog");
      if (attempt < 9 && Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => {
              this.stopDelay = undefined;
              resolve();
            },
            Math.min(2000, deadline - Date.now()),
          );
          this.stopDelay = () => {
            clearTimeout(timer);
            reject(new Error("stale_response"));
          };
        });
      }
    }
    throw new Error("catalog_pending");
  }
}
