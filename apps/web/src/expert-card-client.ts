export interface ExpertPublicCard {
  displayName: string;
  profession: string;
  city: string;
  summary: string;
}
export interface ExpertCardWorkflow {
  assistanceRequested?: boolean;
  applicationId: string;
  draftId: string;
  revision: number;
  status: "collecting" | "manager_review" | "changes_requested" | "approved";
  entryCount: number;
  materialStatus:
    "none" | "waiting_content" | "pending" | "delivered" | "unknown_outcome";
  promoConfirmed: boolean;
}
export interface ExpertCardDraft extends ExpertCardWorkflow {
  assistance?: {
    requestedAt: string | null;
    revision: number | null;
    resolvedAt: string | null;
  };
  rich?: {
    enabled: boolean;
    profile: Record<string, unknown> | null;
    proposal: Record<string, unknown> | null;
    confirmed: boolean | null;
  };
  previousVersion?: {
    profile: Record<string, unknown> | null;
    publicCard: ExpertPublicCard;
    revision: number;
  } | null;
  media?: { id: string; state: string }[];
  returnReason?: string | null;
  effectiveFields?: Record<string, string>;
  safety?: {
    policyId: string;
    revision: number;
    digest: string;
    blocked: boolean;
    issues: {
      field: string;
      ruleId: string | null;
      severity: "BLOCKER" | "WARNING";
      reason: string;
    }[];
  };
  entries: {
    id: string;
    kind: "text" | "photo" | "document";
    text: string | null;
    reference: string | null;
    revision: number;
  }[];
  publicCard: ExpertPublicCard | null;
  approvedReviewId: string | null;
  materials: {
    jobId: string;
    status:
      | "waiting_content"
      | "pending"
      | "delivered"
      | "cancelled"
      | "unknown_outcome";
    contentVersion: string | null;
  } | null;
  promoProofs: {
    id: string;
    kind: "link" | "photo" | "document";
    reference: string;
    revision: number;
    reviewId: string | null;
  }[];
}
export interface CardRevisionCommand {
  expectedRevision: number;
  idempotencyKey: string;
}
export interface ExpertCardAdminClient {
  mediaLink?(
    id: string,
    mediaId: string,
  ): Promise<{ url: string; expiresIn: number }>;
  list(): Promise<ExpertCardWorkflow[]>;
  read(id: string): Promise<ExpertCardDraft>;
  edit(
    id: string,
    input: CardRevisionCommand & { publicCard: ExpertPublicCard },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  review(
    id: string,
    input: CardRevisionCommand & {
      action: "approve" | "return_changes";
      warningAcknowledgment?: string;
      returnReason?: string;
    },
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
  confirmPromo(
    id: string,
    input: CardRevisionCommand,
  ): Promise<ExpertCardWorkflow & { replay: boolean }>;
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    v,
  );
const integer = (v: unknown, min = 1, max = 2147483647): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const invalid = (): never => {
  throw new Error("verification_invalid_response");
};
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(v);
const rawText = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 4000 &&
  !/[\u0000\u000b\u000c\u007f-\u009f]/u.test(v);
const media = (v: unknown): v is string =>
  text(v, 600) && /^telegram:file:[A-Za-z0-9_-]+$/u.test(v);
function httpsProof(v: unknown): v is string {
  if (!text(v, 2048)) return false;
  try {
    const u = new URL(v),
      h = u.hostname.toLowerCase();
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      !h ||
      h === "localhost" ||
      h.endsWith(".localhost") ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      h === "[::1]" ||
      h === "[::]" ||
      /^\[(?:fc|fd|fe80:|::ffff:)/u.test(h)
    )
      return false;
    if (/^\d+\.\d+\.\d+\.\d+$/u.test(h)) {
      const [a, b] = h.split(".").map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 192 && b === 168) ||
        (a === 172 && b! >= 16 && b! <= 31) ||
        (a === 100 && b! >= 64 && b! <= 127)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function validExpertPublicCard(v: unknown): v is ExpertPublicCard {
  if (
    !obj(v) ||
    Object.keys(v).sort().join(",") !== "city,displayName,profession,summary"
  )
    return false;
  return (
    [
      ["displayName", 80],
      ["profession", 120],
      ["city", 80],
      ["summary", 2000],
    ] as const
  ).every(([k, max]) => {
    const value = v[k];
    return (
      text(value, max) &&
      value === value.trim() &&
      !/(?:https?:\/\/|www\.|[A-Za-z0-9._%+-]+@|(?:\+?\d[\s().-]*){8,})/iu.test(
        value,
      )
    );
  });
}
function workflow(v: unknown): v is ExpertCardWorkflow {
  return (
    obj(v) &&
    uuid(v.applicationId) &&
    uuid(v.draftId) &&
    integer(v.revision, 0) &&
    typeof v.status === "string" &&
    ["collecting", "manager_review", "changes_requested", "approved"].includes(
      v.status,
    ) &&
    integer(v.entryCount, 0, 100) &&
    typeof v.materialStatus === "string" &&
    [
      "none",
      "waiting_content",
      "pending",
      "delivered",
      "unknown_outcome",
    ].includes(v.materialStatus) &&
    typeof v.promoConfirmed === "boolean"
  );
}
function draft(v: unknown): v is ExpertCardDraft {
  if (
    !workflow(v) ||
    !obj(v) ||
    !Array.isArray(v.entries) ||
    v.entries.length > 100 ||
    !v.entries.every(
      (e) =>
        obj(e) &&
        uuid(e.id) &&
        integer(e.revision) &&
        e.revision <= v.revision &&
        ((e.kind === "text" && rawText(e.text) && e.reference === null) ||
          ((e.kind === "photo" || e.kind === "document") &&
            e.text === null &&
            media(e.reference))),
    ) ||
    (v.publicCard !== null && !validExpertPublicCard(v.publicCard)) ||
    (v.approvedReviewId !== null && !uuid(v.approvedReviewId)) ||
    !Array.isArray(v.promoProofs) ||
    v.promoProofs.length > 50 ||
    !v.promoProofs.every(
      (p) =>
        obj(p) &&
        uuid(p.id) &&
        ((p.reviewId === null && p.revision === 0) ||
          (uuid(p.reviewId) &&
            p.reviewId === v.approvedReviewId &&
            p.revision === v.revision)) &&
        ((p.kind === "link" && httpsProof(p.reference)) ||
          ((p.kind === "photo" || p.kind === "document") &&
            media(p.reference))),
    )
  )
    return false;
  if (
    v.effectiveFields !== undefined &&
    (!obj(v.effectiveFields) ||
      Object.keys(v.effectiveFields).length > 125 ||
      !Object.values(v.effectiveFields).every(
        (x) => typeof x === "string" && x.length <= 64000,
      ))
  )
    return false;
  if (
    v.safety !== undefined &&
    (!obj(v.safety) ||
      !uuid(v.safety.policyId) ||
      v.safety.revision !== v.revision ||
      typeof v.safety.digest !== "string" ||
      !/^[0-9a-f]{64}$/u.test(v.safety.digest) ||
      typeof v.safety.blocked !== "boolean" ||
      !Array.isArray(v.safety.issues) ||
      !v.safety.issues.every(
        (i) =>
          obj(i) &&
          text(i.field, 100) &&
          (i.ruleId === null || uuid(i.ruleId)) &&
          ["BLOCKER", "WARNING"].includes(String(i.severity)) &&
          text(i.reason, 1000),
      ))
  )
    return false;
  if (
    v.rich !== undefined &&
    (!obj(v.rich) ||
      typeof v.rich.enabled !== "boolean" ||
      (v.rich.profile !== null &&
        (!obj(v.rich.profile) ||
          JSON.stringify(v.rich.profile).length > 100000)) ||
      (v.rich.proposal !== null && !obj(v.rich.proposal)))
  )
    return false;
  if (
    v.media !== undefined &&
    (!Array.isArray(v.media) ||
      v.media.length > 10 ||
      !v.media.every(
        (m) =>
          obj(m) &&
          uuid(m.id) &&
          [
            "allocated",
            "inflight",
            "unknown",
            "verified",
            "unavailable",
          ].includes(String(m.state)),
      ))
  )
    return false;
  const m = v.materials;
  return (
    m === null ||
    (obj(m) &&
      uuid(m.jobId) &&
      typeof m.status === "string" &&
      [
        "waiting_content",
        "pending",
        "delivered",
        "cancelled",
        "unknown_outcome",
      ].includes(m.status) &&
      (m.contentVersion === null || text(m.contentVersion, 128)) &&
      (m.status !== "delivered" || m.contentVersion !== null))
  );
}
function command(id: string, input: CardRevisionCommand, keys: string) {
  if (
    !uuid(id) ||
    !obj(input) ||
    Object.keys(input).sort().join(",") !== keys ||
    !integer(input.expectedRevision, 0) ||
    !text(input.idempotencyKey, 128) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)
  )
    return invalid();
}
export function createExpertCardClient(
  request: (path: string, body?: unknown) => Promise<Record<string, unknown>>,
): ExpertCardAdminClient {
  const mutation = async (
    id: string,
    route: string,
    input: CardRevisionCommand,
  ) => {
    const expectedRevision = input.expectedRevision;
    const snapshot: Record<string, unknown> = { ...input };
    if (obj(snapshot.publicCard))
      snapshot.publicCard = { ...snapshot.publicCard };
    const value = await request(`/${id}/${route}`, snapshot),
      v = value.item;
    if (obj(v) && v.safetyBlocked === true && Array.isArray(v.safetyIssues)) {
      const reasons = v.safetyIssues
        .filter((i) => obj(i) && text(i.field, 100) && text(i.reason, 1000))
        .map((i) => `${i.field}: ${i.reason}`)
        .join(" ");
      throw new Error(`card_safety_blocked:${reasons}`);
    }
    if (
      !workflow(v) ||
      !obj(v) ||
      v.applicationId !== id ||
      v.revision < expectedRevision ||
      (route === "public-card" && v.revision <= expectedRevision) ||
      typeof v.replay !== "boolean"
    )
      return invalid();
    return { ...v, replay: v.replay };
  };
  return {
    async mediaLink(id, mediaId) {
      if (!uuid(id) || !uuid(mediaId)) return invalid();
      const r = await request(`/${id}/media/${mediaId}/link`, {});
      if (
        typeof r.url !== "string" ||
        !r.url.startsWith("https://") ||
        r.expiresIn !== 120
      )
        return invalid();
      return { url: r.url, expiresIn: 120 };
    },
    async list() {
      const value = await request("?limit=50");
      if (
        !Array.isArray(value.items) ||
        value.items.length > 50 ||
        !value.items.every(workflow)
      )
        return invalid();
      return value.items;
    },
    async read(id) {
      if (!uuid(id)) return invalid();
      const value = await request(`/${id}`);
      if (!draft(value.item) || value.item.applicationId !== id)
        return invalid();
      return value.item;
    },
    async edit(id, input) {
      command(id, input, "expectedRevision,idempotencyKey,publicCard");
      if (!validExpertPublicCard(input.publicCard)) return invalid();
      return mutation(id, "public-card", input);
    },
    async review(id, input) {
      command(
        id,
        input,
        [
          "action",
          "expectedRevision",
          "idempotencyKey",
          ...(input.warningAcknowledgment === undefined
            ? []
            : ["warningAcknowledgment"]),
          ...(input.returnReason === undefined ? [] : ["returnReason"]),
        ]
          .sort()
          .join(","),
      );
      if (
        input.warningAcknowledgment !== undefined &&
        !/^[0-9a-f]{64}$/u.test(input.warningAcknowledgment)
      )
        return invalid();
      if (input.action !== "approve" && input.action !== "return_changes")
        return invalid();
      return mutation(id, "review", input);
    },
    async confirmPromo(id, input) {
      command(id, input, "expectedRevision,idempotencyKey");
      return mutation(id, "promo-review", input);
    },
  };
}
