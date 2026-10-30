/** This runner is intentionally uncomposed until a durable store and strict sender exist. */
export type LaunchMaterialClaim = Readonly<{
  jobId: string;
  attemptId: string;
  userId: string;
}>;
export type LaunchMaterialCandidate = Readonly<{
  configVersion: string;
  templateId: string;
  contentVersion: string;
  payloadDigest: string;
  payload: Readonly<{
    text: string;
    assets: readonly Readonly<{
      kind: "photo" | "document";
      reference: string;
    }>[];
  }>;
}>;
export type LaunchMaterialResult =
  | Readonly<{ kind: "delivered"; messageIds: readonly string[] }>
  | Readonly<{ kind: "retry" | "cancelled" | "uncertain" }>;

/**
 * claim and dispatch must be durable and attempt-bound. prepare must select only
 * approved templates without placeholders, and recheck verified payment, current
 * coverage, recipient, launch config and current consent under the relevant locks.
 * A dispatched or uncertain attempt may never be automatically re-enqueued.
 */
export interface LaunchMaterialStore {
  claim(): Promise<LaunchMaterialClaim | null>;
  prepare(
    claim: LaunchMaterialClaim,
  ): Promise<
    | Readonly<{ kind: "ready"; candidate: LaunchMaterialCandidate }>
    | Readonly<{ kind: "pending" | "ineligible" }>
  >;
  dispatch(claim: LaunchMaterialClaim): Promise<boolean>;
  finish(
    claim: LaunchMaterialClaim,
    result: LaunchMaterialResult,
  ): Promise<boolean>;
}
/** Must recheck current eligibility, phase, template and messaging consent at send admission. */
export interface LaunchMaterialSender {
  readonly strictAuthority: true;
  sendIfAuthorized(
    input: Readonly<{
      claim: LaunchMaterialClaim;
      candidate: LaunchMaterialCandidate;
    }>,
    signal: AbortSignal,
  ): Promise<
    | Readonly<{ kind: "delivered"; messageIds: readonly string[] }>
    | Readonly<{ kind: "cancelled" | "uncertain" }>
  >;
}

export class EarlyBirdLaunchMaterialsRunner {
  constructor(
    private readonly store: LaunchMaterialStore,
    private readonly sender: LaunchMaterialSender | undefined,
  ) {}
  async run(
    limit: number,
    signal: AbortSignal,
  ): Promise<{ delivered: number; uncertain: number }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw new Error("early_bird_material_limit_invalid");
    const result = { delivered: 0, uncertain: 0 };
    if (!this.sender || this.sender.strictAuthority !== true || signal.aborted)
      return result;
    for (let i = 0; i < limit && !signal.aborted; i++) {
      const claim = await this.store.claim();
      if (!claim) break;
      let prepared: Awaited<ReturnType<LaunchMaterialStore["prepare"]>>;
      try {
        prepared = await this.store.prepare(claim);
      } catch {
        await this.store.finish(claim, { kind: "retry" });
        continue;
      }
      if (prepared.kind !== "ready") {
        await this.store.finish(claim, {
          kind: prepared.kind === "pending" ? "retry" : "cancelled",
        });
        continue;
      }
      const c = prepared.candidate;
      if (
        !c ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(c.configVersion) ||
        !/^[A-Za-z0-9_-]{1,64}$/u.test(c.templateId) ||
        !/^[A-Za-z0-9_.-]{1,64}$/u.test(c.contentVersion) ||
        !/^sha256:[a-f0-9]{64}$/u.test(c.payloadDigest) ||
        typeof c.payload?.text !== "string" ||
        !c.payload.text.trim() ||
        c.payload.text.includes("{{") ||
        c.payload.text.includes("}}") ||
        !Array.isArray(c.payload.assets) ||
        c.payload.assets.length > 10 ||
        Array.from(
          { length: c.payload.assets.length },
          (_, index) => index,
        ).some((index) => !Object.hasOwn(c.payload.assets, index)) ||
        c.payload.assets.some(
          (a) =>
            !a ||
            !["photo", "document"].includes(a.kind) ||
            typeof a.reference !== "string" ||
            !a.reference.trim(),
        )
      ) {
        await this.store.finish(claim, { kind: "cancelled" });
        continue;
      }
      if (signal.aborted) {
        await this.store.finish(claim, { kind: "retry" });
        break;
      }
      if (!(await this.store.dispatch(claim))) continue;
      let outcome: LaunchMaterialResult = { kind: "uncertain" };
      try {
        const sent = await this.sender.sendIfAuthorized(
          { claim, candidate: c },
          signal,
        );
        if (
          sent.kind === "delivered" &&
          Array.isArray(sent.messageIds) &&
          sent.messageIds.length === 1 + c.payload.assets.length &&
          new Set(sent.messageIds).size === sent.messageIds.length &&
          sent.messageIds.every(
            (id) => typeof id === "string" && /^[1-9]\d{0,19}$/u.test(id),
          )
        )
          outcome = sent;
      } catch {
        /* dispatch is already durable; never assume no send occurred */
      }
      let saved = false;
      try {
        saved = await this.store.finish(claim, outcome);
      } catch {
        /* reconcile dispatched attempt */
      }
      if (!saved || outcome.kind === "uncertain") result.uncertain++;
      else if (outcome.kind === "delivered") result.delivered++;
    }
    return result;
  }
}
