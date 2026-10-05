export interface BrowserSession {
  available: boolean;
  authenticated: boolean;
  csrfToken?: string;
  botUsername?: string;
  widgetEnabled?: boolean;
  privacyAvailable?: boolean;
  erasureAvailable: false;
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
export class PrivacyClient {
  authenticated = false;
  private csrf = "";
  private states: ConsentState[] = [];
  private epoch = 0;
  private recovering = false;
  private readonly presentations = new Map<string, ConsentPresentation>();
  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly options: { timeoutMs?: number } = {},
  ) {}
  private async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const epoch = this.epoch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("privacy_request_timeout"));
      }, this.options.timeoutMs ?? 10000);
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
        ++this.epoch;
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
  async probe(): Promise<BrowserSession> {
    const session = await this.call<BrowserSession>("session");
    const authenticated = session.authenticated === true;
    const csrf = session.csrfToken ?? "";
    // CSRF is bound to the cookie session. A changed probe invalidates operations
    // started under the previous authority, even if both accounts are authenticated.
    if (authenticated !== this.authenticated || csrf !== this.csrf) {
      ++this.epoch;
      this.states = [];
      this.presentations.clear();
    }
    this.authenticated = authenticated;
    this.csrf = csrf;
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
    ++this.epoch;
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
  async logout(): Promise<void> {
    ++this.epoch;
    await this.call("session", "DELETE");
    ++this.epoch;
    this.authenticated = false;
    this.csrf = "";
    this.states = [];
    this.presentations.clear();
  }
}
