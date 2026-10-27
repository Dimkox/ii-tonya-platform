export interface ExpertBrowserSession {
  available: boolean;
  authenticated: boolean;
  csrfToken?: string;
  botUsername?: string;
  widgetEnabled?: boolean;
  userId?: string;
  expertId?: string;
  expiresAt?: string;
}
export class ExpertAccountClient {
  authenticated = false;
  private csrf = "";
  private epoch = 0;
  private mutation: Promise<void> | undefined;
  private logoutOperation: Promise<void> | undefined;
  constructor(
    private readonly request: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async call(
    method: string,
    epoch: number,
    body?: unknown,
  ): Promise<ExpertBrowserSession> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.request("/v1/expert/browser/session", {
          method,
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: {
            ...(method === "GET" ? {} : { "x-csrf-token": this.csrf }),
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("expert_session_unavailable"));
          }, 10000);
        }),
      ]);
      const value =
        response.ok && response.status !== 204
          ? ((await response.json()) as ExpertBrowserSession)
          : undefined;
      if (epoch !== this.epoch) throw new Error("stale_response");
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "expert_login_denied"
            : "expert_session_unavailable",
        );
      return value ?? { available: true, authenticated: false };
    } finally {
      clearTimeout(timer);
    }
  }
  async probe(): Promise<ExpertBrowserSession> {
    if (this.logoutOperation) throw new Error("expert_session_busy");
    const epoch = ++this.epoch;
    const result = await this.call("GET", epoch);
    this.authenticated = result.authenticated === true;
    this.csrf = result.csrfToken ?? "";
    return result;
  }
  async login(proof: string): Promise<void> {
    if (this.mutation || this.logoutOperation)
      throw new Error("expert_session_busy");
    const epoch = ++this.epoch;
    this.authenticated = false;
    const operation = (async () => {
      const result = await this.call("POST", epoch, { identityProof: proof });
      this.csrf = result.csrfToken ?? "";
      this.authenticated = result.authenticated === true;
    })();
    this.mutation = operation;
    try {
      await operation;
    } finally {
      if (this.mutation === operation) this.mutation = undefined;
    }
  }
  async logout(): Promise<void> {
    if (this.logoutOperation) return this.logoutOperation;
    ++this.epoch;
    this.authenticated = false;
    // Wait for a pending login's cookie response, then probe its CSRF and revoke.
    // UI authority is already fenced; a late Set-Cookie cannot bypass this delete.
    const pending = this.mutation;
    const operation = (async () => {
      if (pending) {
        try {
          await pending;
        } catch {
          /* logout still proceeds */
        }
        const result = await this.call("GET", this.epoch);
        this.csrf = result.csrfToken ?? "";
      }
      const epoch = ++this.epoch;
      await this.call("DELETE", epoch);
      this.csrf = "";
      this.authenticated = false;
    })();
    this.logoutOperation = operation;
    try {
      await operation;
    } finally {
      this.authenticated = false;
      if (this.logoutOperation === operation) this.logoutOperation = undefined;
    }
  }
}
