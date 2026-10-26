import {
  createExpertCardClient,
  type ExpertCardAdminClient,
} from "./expert-card-client.js";
export interface VerificationEntry {
  applicationId: string;
  status: "pending" | "approved" | "rejected";
  maskedContact: string;
  quoteId: string;
  termMonths: 1 | 3;
  priceMinor: string;
  currency: "RUB";
}
export interface VerificationDetail extends Omit<
  VerificationEntry,
  "maskedContact"
> {
  userId: string;
  profile?: {
    revision: number;
    cityCode: string;
    millionCity: boolean;
    serviceFormat: "online_only" | "offline" | "hybrid";
    ticketMinor: string;
    verified: boolean;
  } | null;
  contact: { provider: "telegram"; externalId: string }[];
  questionnaire:
    | {
        status: "waiting_content";
        contentSlot: "TODO: Wait for Content Spec";
      }
    | {
        status: "submitted";
        draft: Record<string, unknown>;
        submittedRevision: number;
        formVersion: 1 | 2;
        revision: number;
        generation: number;
        lifecycle: string;
        supplements: unknown;
        history?: { nextCursor: string | null };
        messages?:
          { eventId: string; status: string; receipt: string | null }[] | null;
      };
}
export type VerificationPayment =
  | { status: "ready"; url: string; paymentId: string }
  | {
      status:
        | "waiting_configuration"
        | "unavailable"
        | "pending"
        | "not_repeated"
        | "settled"
        | "cancelled";
    };
export interface VerificationDecision {
  applicationId: string;
  decision: "approved" | "rejected";
  invoiceId: string | null;
  replay: boolean;
  payment?: VerificationPayment;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    v,
  );
const invalid = (): never => {
  throw new Error("verification_invalid_response");
};
function entry(v: unknown): v is VerificationEntry {
  return (
    object(v) &&
    uuid(v.applicationId) &&
    typeof v.status === "string" &&
    ["pending", "approved", "rejected"].includes(v.status) &&
    uuid(v.quoteId) &&
    (v.termMonths === 1 || v.termMonths === 3) &&
    typeof v.priceMinor === "string" &&
    /^(?:0|[1-9]\d{0,17})$/u.test(v.priceMinor) &&
    v.currency === "RUB"
  );
}
function payment(v: unknown): VerificationPayment {
  if (!object(v) || typeof v.status !== "string") return invalid();
  if (v.status !== "ready")
    return [
      "waiting_configuration",
      "unavailable",
      "pending",
      "not_repeated",
      "settled",
      "cancelled",
    ].includes(v.status)
      ? { status: v.status as Exclude<VerificationPayment["status"], "ready"> }
      : invalid();
  if (
    typeof v.url !== "string" ||
    v.url.length > 2048 ||
    typeof v.paymentId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(v.paymentId)
  )
    return invalid();
  const url = new URL(v.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !["yookassa.ru", "pay.yookassa.ru", "yoomoney.ru"].includes(url.hostname)
  )
    return invalid();
  return { status: "ready", url: url.toString(), paymentId: v.paymentId };
}
export class ExpertVerificationClient {
  readonly cards: ExpertCardAdminClient;
  private token: string;
  private readonly abort = new AbortController();
  constructor(
    token: string,
    private readonly fetcher: typeof fetch = (...args) =>
      globalThis.fetch(...args),
  ) {
    if (!/^[A-Za-z0-9._~-]{24,512}$/u.test(token))
      throw new Error("verification_unauthorized");
    this.token = token;
    this.cards = createExpertCardClient((path, body) =>
      this.request(path, body, body !== undefined, "/v1/admin/expert-cards"),
    );
  }
  clear() {
    this.token = "";
    this.abort.abort();
  }
  private async request(
    path: string,
    body?: unknown,
    post = false,
    base = "/v1/admin/expert-verification",
  ): Promise<Record<string, unknown>> {
    if (!this.token) throw new Error("verification_unauthorized");
    const response = await this.fetcher(`${base}${path}`, {
      method: post ? "POST" : "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: this.abort.signal,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 || response.status === 403) {
      this.clear();
      throw new Error("verification_unauthorized");
    }
    if (!response.ok) throw new Error("verification_unavailable");
    const text = await response.text();
    if (text.length > (base === "/v1/admin/expert-cards" ? 1048576 : 262144))
      return invalid();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return invalid();
    }
    if (!object(value) || value.kind !== "ok") return invalid();
    return value;
  }
  async list(afterApplication?: string): Promise<VerificationEntry[]> {
    if (afterApplication !== undefined && !uuid(afterApplication))
      return invalid();
    const value = await this.request(
      `?limit=50${afterApplication ? `&afterApplication=${encodeURIComponent(afterApplication)}` : ""}`,
    );
    if (
      !Array.isArray(value.items) ||
      value.items.length > 50 ||
      !value.items.every((v) => entry(v) && v.maskedContact === "telegram:***")
    )
      return invalid();
    return value.items as VerificationEntry[];
  }
  async detail(
    id: string,
    historyCursor?: string,
  ): Promise<VerificationDetail> {
    if (
      !uuid(id) ||
      (historyCursor !== undefined &&
        (typeof historyCursor !== "string" ||
          !/^(0|[1-9][0-9]{0,9}):[a-f0-9-]{36}:[a-f0-9-]{36}$/u.test(
            historyCursor,
          )))
    )
      return invalid();
    const value = await this.request(
        `/${id}${historyCursor ? `?historyCursor=${encodeURIComponent(historyCursor)}` : ""}`,
      ),
      v = value.item;
    if (
      !entry(v) ||
      !object(v) ||
      v.applicationId !== id ||
      !uuid(v.userId) ||
      !Array.isArray(v.contact) ||
      v.contact.length > 5 ||
      !v.contact.every(
        (c) =>
          object(c) &&
          c.provider === "telegram" &&
          typeof c.externalId === "string" &&
          /^[1-9]\d{0,19}$/u.test(c.externalId),
      ) ||
      !object(v.questionnaire) ||
      !(
        (v.questionnaire.status === "waiting_content" &&
          v.questionnaire.contentSlot === "TODO: Wait for Content Spec") ||
        (v.questionnaire.status === "submitted" &&
          object(v.questionnaire.draft) &&
          JSON.stringify(v.questionnaire.draft).length <= 100000 &&
          Number.isSafeInteger(v.questionnaire.submittedRevision) &&
          [1, 2].includes(Number(v.questionnaire.formVersion)) &&
          Number.isSafeInteger(v.questionnaire.revision) &&
          Number.isSafeInteger(v.questionnaire.generation) &&
          typeof v.questionnaire.lifecycle === "string")
      )
    )
      return invalid();
    if (
      v.questionnaire.status === "submitted" &&
      v.questionnaire.history !== undefined
    ) {
      const history = v.questionnaire.history;
      if (
        !object(history) ||
        (history.nextCursor !== null &&
          (typeof history.nextCursor !== "string" ||
            !/^(0|[1-9][0-9]{0,9}):[a-f0-9-]{36}:[a-f0-9-]{36}$/u.test(
              history.nextCursor,
            )))
      )
        return invalid();
    }
    if (v.profile !== undefined && v.profile !== null) {
      const p = v.profile;
      if (
        !object(p) ||
        !Number.isSafeInteger(p.revision) ||
        Number(p.revision) < 1 ||
        typeof p.cityCode !== "string" ||
        p.cityCode.length > 100 ||
        typeof p.millionCity !== "boolean" ||
        !["online_only", "offline", "hybrid"].includes(
          String(p.serviceFormat),
        ) ||
        typeof p.ticketMinor !== "string" ||
        !/^(?:0|[1-9]\d{0,18})$/u.test(p.ticketMinor) ||
        typeof p.verified !== "boolean"
      )
        return invalid();
    }
    return v as unknown as VerificationDetail;
  }
  async closeUnknownReview(id: string, eventId: string) {
    if (!uuid(id) || !uuid(eventId)) return invalid();
    const value = await this.request(
      `/${id}/review-recovery`,
      { eventId },
      true,
    );
    if (
      !object(value.item) ||
      value.item.eventId !== eventId ||
      value.item.status !== "closed_without_resend"
    )
      return invalid();
  }
  async previewReview(
    id: string,
    input: {
      key: string;
      expectedRevision: number;
      expectedGeneration: number;
      questions?: string[];
      tone?: string;
    },
  ) {
    if (!uuid(id)) return invalid();
    const value = await this.request(`/${id}/review-preview`, input, true),
      v = value.item;
    if (
      !object(v) ||
      !uuid(v.previewId) ||
      typeof v.text !== "string" ||
      v.text.length > 4096 ||
      typeof v.hash !== "string" ||
      !/^[0-9a-f]{64}$/u.test(v.hash) ||
      typeof v.expiresAt !== "string"
    )
      return invalid();
    return {
      previewId: v.previewId as string,
      text: v.text,
      hash: v.hash,
      expiresAt: v.expiresAt,
    };
  }
  async confirmReview(id: string, previewId: string, finalHash: string) {
    if (!uuid(id) || !uuid(previewId) || !/^[0-9a-f]{64}$/u.test(finalHash))
      return invalid();
    const value = await this.request(
        `/${id}/review-confirm`,
        { previewId, finalHash },
        true,
      ),
      v = value.item;
    if (
      !object(v) ||
      !uuid(v.eventId) ||
      typeof v.action !== "string" ||
      typeof v.replay !== "boolean"
    )
      return invalid();
    return { eventId: v.eventId as string, action: v.action, replay: v.replay };
  }
  async decide(
    id: string,
    decision: "approved" | "rejected",
    reasonCode: string,
    idempotencyKey: string,
  ): Promise<VerificationDecision> {
    if (
      !uuid(id) ||
      !["approved", "rejected"].includes(decision) ||
      !/^[a-z][a-z0-9_]{0,63}$/u.test(reasonCode) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(idempotencyKey)
    )
      return invalid();
    const v = await this.request(
      `/${id}/decision`,
      { decision, reasonCode, idempotencyKey },
      true,
    );
    if (
      v.applicationId !== id ||
      v.decision !== decision ||
      (decision === "approved" && !uuid(v.invoiceId)) ||
      (decision === "rejected" && v.invoiceId !== null) ||
      (v.invoiceId !== null && !uuid(v.invoiceId)) ||
      typeof v.replay !== "boolean"
    )
      return invalid();
    return {
      applicationId: id,
      decision,
      invoiceId: v.invoiceId as string | null,
      replay: v.replay,
      ...(v.payment === undefined ? {} : { payment: payment(v.payment) }),
    };
  }
  async reverifyProfile(
    applicationId: string,
    revision: number,
  ): Promise<void> {
    if (!uuid(applicationId) || !Number.isSafeInteger(revision) || revision < 1)
      return invalid();
    const result = await this.request(
      `/${applicationId}/profile-verification`,
      { revision },
      true,
    );
    if (result.applicationId !== applicationId || result.revision !== revision)
      return invalid();
  }
  async recover(invoiceId: string): Promise<VerificationPayment> {
    if (!uuid(invoiceId)) return invalid();
    return payment(
      (await this.request(`/invoices/${invoiceId}/checkout`, undefined, true))
        .payment,
    );
  }
}
