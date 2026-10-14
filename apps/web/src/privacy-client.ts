export interface BrowserSession {
  available: boolean;
  authenticated: boolean;
  csrfToken?: string;
  botUsername?: string;
  widgetEnabled?: boolean;
  privacyAvailable?: boolean;
  erasureAvailable: boolean;
  bookingAvailable?: boolean;
  bookingReserveAvailable?: boolean;
}
export interface ConsentState {
  purpose: string;
  inForce: boolean;
  policyVersion: string;
  decidedAt?: string;
}
export interface ConsentPresentation {
  token: string;
  policyVersion: string;
  document: {
    id: string;
    documentKey: string;
    title: string;
    body: string;
    version: number;
    textSha256: string;
  };
}
export class PrivacyApiError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "session_expired" : "privacy_request_failed");
  }
}
export interface ErasureProgress {
  requestId: string;
  requestedAt: string;
  stage:
    | "awaiting_execution"
    | "deleting"
    | "awaiting_backup"
    | "needs_attention"
    | "completed";
  retainedFacts: {
    ledgerFactsPreserved: number;
    auditFactsPreserved: number;
  } | null;
}
export class PrivacyClient {
  private erasureReceipt = "";
  private erasureAvailable = false;
  authenticated = false;
  private csrf = "";
  private states: ConsentState[] = [];
  private epoch = 0;
  private recovering = false;
  private readonly authorityListeners = new Set<() => void>();
  onAuthorityChange(listener: () => void): () => void {
    this.authorityListeners.add(listener);
    return () => {
      this.authorityListeners.delete(listener);
    };
  }
  private advanceEpoch(): void {
    this.erasureReceipt = "";
    this.erasureAvailable = false;
    ++this.epoch;
    for (const listener of this.authorityListeners) listener();
  }
  private bookingAvailable = false;
  private bookingReserveAvailable = false;
  get sessionEpoch(): number {
    return this.epoch;
  }
  async bookingRequest<T>(
    path: string,
    method = "GET",
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    this.requireSession();
    if (
      !/^(?:bookings(?:\?after=bk1\.[A-Za-z0-9_-]{43}|\/bk1\.[A-Za-z0-9_-]{43})?|catalog-requests(?:\/[0-9a-f-]{36})?)$/u.test(
        path,
      )
    )
      throw new Error("invalid_booking_path");
    if (
      path.startsWith("bookings") &&
      (!this.bookingAvailable ||
        (method === "POST" && !this.bookingReserveAvailable))
    )
      throw new PrivacyApiError(503);
    return this.call<T>(path, method, body, timeoutMs);
  }
  private readonly presentations = new Map<string, ConsentPresentation>();
  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly options: { timeoutMs?: number } = {},
  ) {}
  private async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const epoch = this.epoch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new Error("privacy_request_timeout"));
        },
        Math.min(timeoutMs ?? 10000, this.options.timeoutMs ?? 10000),
      );
    });
    let response: Response;
    let value: T;
    try {
      ({ response, value } = await Promise.race([
        timeout,
        (async () => {
          const response = await this.request(`/v1/browser/${path}`, {
            signal: controller.signal,
            method,
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            headers: {
              ...(method === "GET" && path === "session"
                ? {}
                : { "x-csrf-token": this.csrf }),
              ...(body === undefined
                ? {}
                : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const value =
            response.ok && response.status !== 204
              ? ((await response.json()) as T)
              : (undefined as T);
          return { response, value };
        })(),
      ]));
    } finally {
      clearTimeout(timer);
    }
    if (epoch !== this.epoch) throw new Error("stale_response");
    if (!response.ok) {
      if (response.status === 401) {
        this.advanceEpoch();
        this.authenticated = false;
        this.csrf = "";
        this.presentations.clear();
        this.states = [];
      }
      if (
        response.status === 403 &&
        !this.recovering &&
        !(path === "session" && method === "GET")
      ) {
        this.presentations.clear();
        this.states = [];
        this.recovering = true;
        try {
          await this.probe();
          if (this.authenticated) await this.list();
        } catch {
          /* The caller still receives the original rejection; never replay a write. */
        } finally {
          this.recovering = false;
        }
      }
      throw new PrivacyApiError(response.status);
    }
    return value;
  }
  private requireSession() {
    if (!this.authenticated) throw new PrivacyApiError(401);
  }
  async packages(): Promise<ClientAccountPackages> {
    this.requireSession();
    return parseClientAccountPackages(await this.call<unknown>("packages"));
  }
  async probe(): Promise<BrowserSession> {
    const session = await this.call<BrowserSession>("session");
    const authenticated = session.authenticated === true;
    const csrf = session.csrfToken ?? "";
    // CSRF is bound to the cookie session. A changed probe invalidates operations
    // started under the previous authority, even if both accounts are authenticated.
    if (authenticated !== this.authenticated || csrf !== this.csrf) {
      this.advanceEpoch();
      this.states = [];
      this.presentations.clear();
    }
    this.authenticated = authenticated;
    this.erasureAvailable = authenticated && session.erasureAvailable === true;
    this.csrf = csrf;
    this.bookingAvailable = authenticated && session.bookingAvailable === true;
    this.bookingReserveAvailable =
      this.bookingAvailable && session.bookingReserveAvailable === true;
    if (!this.authenticated) {
      this.states = [];
      this.presentations.clear();
    }
    return session;
  }
  async login(identityProof: string): Promise<void> {
    const result = await this.call<{ csrfToken: string }>("session", "POST", {
      identityProof,
    });
    this.advanceEpoch();
    this.authenticated = true;
    this.csrf = result.csrfToken;
  }
  async present(purpose: string): Promise<ConsentPresentation> {
    this.requireSession();
    this.presentations.delete(purpose);
    const value = await this.call<ConsentPresentation>(
      "privacy/presentations",
      "POST",
      { purpose, channel: "web", documentKey: `consent.${purpose}` },
    );
    if (
      typeof value.token !== "string" ||
      typeof value.policyVersion !== "string" ||
      typeof value.document?.body !== "string" ||
      typeof value.document.title !== "string" ||
      !Number.isInteger(value.document.version) ||
      !/^[0-9a-f]{64}$/u.test(value.document.textSha256) ||
      value.document.documentKey !== `consent.${purpose}`
    )
      throw new Error("document_unavailable");
    this.presentations.set(purpose, value);
    return value;
  }
  async decide(purpose: string, decision: "granted" | "denied"): Promise<void> {
    this.requireSession();
    const shown = this.presentations.get(purpose);
    if (
      !shown ||
      (decision === "denied" &&
        this.states.some((s) => s.purpose === purpose && s.inForce))
    )
      throw new Error("document_decision_unavailable");
    try {
      await this.call("privacy/decisions", "POST", {
        token: shown.token,
        purpose,
        policyVersion: shown.policyVersion,
        decision,
      });
    } finally {
      this.presentations.delete(purpose);
    }
  }
  async list(): Promise<ConsentState[]> {
    this.requireSession();
    this.states = (
      await this.call<{ consents: ConsentState[] }>("privacy/consents")
    ).consents;
    return this.states;
  }
  async withdraw(purpose: string): Promise<void> {
    this.requireSession();
    const current = this.states.find((s) => s.purpose === purpose && s.inForce);
    if (!current) throw new Error("consent_not_active");
    await this.call("privacy/consents/withdraw", "POST", {
      purpose,
      policyVersion: current.policyVersion,
    });
    current.inForce = false;
    this.presentations.delete(purpose);
  }
  async withdrawAll(): Promise<{
    withdrawn: string[];
    failed: string[];
    remainingActive: string[];
    verified: boolean;
    interrupted?: "session_changed";
    notAttempted?: string[];
  }> {
    this.requireSession();
    const epoch = this.epoch;
    const csrf = this.csrf;
    const interrupted = (error?: unknown) =>
      epoch !== this.epoch ||
      csrf !== this.csrf ||
      !this.authenticated ||
      (error instanceof PrivacyApiError &&
        (error.status === 401 || error.status === 403));
    const result = {
      withdrawn: [] as string[],
      failed: [] as string[],
      remainingActive: [] as string[],
      verified: false,
    };
    const stop = (notAttempted: string[]) => {
      // Recovery may have observed another account. Keep only this operation's
      // receipts; no cached state/presentation authorizes continuing the bulk.
      this.states = [];
      this.presentations.clear();
      return {
        ...result,
        interrupted: "session_changed" as const,
        notAttempted,
      };
    };
    let authoritative: ConsentState[];
    try {
      authoritative = await this.list();
    } catch (error) {
      if (interrupted(error)) return stop([]);
      throw error;
    }
    const active = authoritative.filter((state) => state.inForce);
    for (const [index, state] of active.entries()) {
      if (interrupted())
        return stop(active.slice(index).map((state) => state.purpose));
      try {
        await this.withdraw(state.purpose);
        result.withdrawn.push(state.purpose);
      } catch (error) {
        result.failed.push(state.purpose);
        if (interrupted(error))
          return stop(active.slice(index + 1).map((state) => state.purpose));
      }
    }
    if (interrupted()) return stop([]);
    try {
      const finalState = await this.list();
      if (interrupted()) return stop([]);
      result.remainingActive = finalState
        .filter((s) => s.inForce)
        .map((s) => s.purpose);
      result.verified = true;
    } catch (error) {
      if (interrupted(error)) return stop([]);
      /* Keep confirmed receipts even when the final snapshot is unavailable. */
    }
    return result;
  }
  async export(): Promise<unknown> {
    this.requireSession();
    return this.call("privacy/export");
  }
  prepareErasureReceipt(): string {
    this.requireSession();
    if (!this.erasureAvailable) throw new PrivacyApiError(503);
    if (!this.erasureReceipt) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      this.erasureReceipt = `er1.${btoa(String.fromCharCode(...bytes))
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/u, "")}`;
    }
    return this.erasureReceipt;
  }
  async requestErasure(): Promise<ErasureProgress> {
    return this.call("privacy/erasure-requests", "POST", {
      receiptToken: this.prepareErasureReceipt(),
      confirmed: true,
    });
  }
  async readOwnedErasure(): Promise<ErasureProgress> {
    this.requireSession();
    return this.call("privacy/erasure-requests");
  }
  async readErasureReceipt(receiptToken: string): Promise<ErasureProgress> {
    const response = await this.request("/v1/browser/privacy/erasure-status", {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 10000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ receiptToken }),
    });
    if (!response.ok) throw new PrivacyApiError(response.status);
    return response.json() as Promise<ErasureProgress>;
  }
  async logout(): Promise<void> {
    this.advanceEpoch();
    await this.call("session", "DELETE");
    this.advanceEpoch();
    this.authenticated = false;
    this.csrf = "";
    this.states = [];
    this.presentations.clear();
  }
}
import {
  parseClientAccountPackages,
  type ClientAccountPackages,
} from "../../../packages/contracts/src/client-account-packages.js";
