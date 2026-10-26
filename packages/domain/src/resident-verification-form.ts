/** Applicant data only. No status, price, check result or manager authority belongs here. */
export const residentRoles = [
  "EXPERT",
  "CENTER",
  "ORGANIZER",
  "EDU_PROJECT",
  "ESOTERIC",
  "OTHER",
] as const;
export type ResidentRole = (typeof residentRoles)[number];
export interface ResidentDocument {
  kind: "photo" | "document";
  fileId: string;
  mimeType: string | null;
  size: number | null;
  caption?: string;
}
export interface ResidentDraft {
  primaryRole?: ResidentRole;
  roles?: ResidentRole[];
  category?: "BASIC" | "EXCLUSIVE" | "BOTH";
  tax?: "SELF_EMPLOYED" | "IP" | "LLC" | "INDIVIDUAL";
  city?: string;
  socialLinks?: string[];
  motivation?: string;
  specialization?: string;
  averageCheckMinor?: string;
  education?: ResidentDocument[];
  propertyEvidence?: ResidentDocument[];
  capacity?: number;
  amenities?: string[];
  path?: string;
  cases?: string;
}
export type ResidentField = keyof ResidentDraft;
export interface ResidentPolicy {
  version: string;
  education: "required" | "optional" | "unknown_manual_review";
}
export const residentPolicy: ResidentPolicy = {
  version: "resident_education_unknown_v1",
  education: "unknown_manual_review",
};
const choices = {
  primaryRole: residentRoles,
  roles: residentRoles,
  category: ["BASIC", "EXCLUSIVE", "BOTH"],
  tax: ["SELF_EMPLOYED", "IP", "LLC", "INDIVIDUAL"],
};
function fail(): never {
  throw new Error("resident_patch_invalid");
}
/** Leaves ample room for PostgreSQL JSONB spacing below its 100000-byte guard. */
export const RESIDENT_DRAFT_MAX_BYTES = 64000;
const forbiddenText = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;
const socialUrl =
  /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:[/?#][^\s\\]*)?$/iu;
export function normalizeResidentSocialUrl(value: string): string {
  if (
    forbiddenText.test(value) ||
    /[\s\\]/u.test(value) ||
    !socialUrl.test(value)
  )
    fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !socialUrl.test(url.href)
  )
    fail();
  return url.href;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function applyResidentPatch(
  draft: ResidentDraft,
  patch: unknown,
): ResidentDraft {
  if (!record(patch) || Object.keys(patch).length > 16) fail();
  const clean: Record<string, unknown> = {};
  const clearPrimary =
    Object.hasOwn(patch, "primaryRole") &&
    (patch as Record<string, unknown>).primaryRole === null;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (key === "primaryRole" && value === null) continue;
    if (Object.hasOwn(choices, key)) {
      const allowed = choices[key as keyof typeof choices] as readonly string[];
      if (key === "roles") {
        if (
          !Array.isArray(value) ||
          value.length < 1 ||
          value.length > 6 ||
          new Set(value).size !== value.length ||
          value.some((v) => typeof v !== "string" || !allowed.includes(v))
        )
          fail();
        clean[key] = [...value];
      } else {
        if (typeof value !== "string" || !allowed.includes(value)) fail();
        clean[key] = value;
      }
    } else if (
      ["city", "motivation", "specialization", "path", "cases"].includes(key)
    ) {
      const max = key === "city" ? 120 : key === "specialization" ? 300 : 3000;
      if (
        typeof value !== "string" ||
        value.trim().length < 1 ||
        value.length > max ||
        /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value)
      )
        fail();
      clean[key] = value;
    } else if (key === "averageCheckMinor") {
      if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,11})$/u.test(value))
        fail();
      clean[key] = value;
    } else if (key === "capacity") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 1 ||
        value > 100000
      )
        fail();
      clean[key] = value;
    } else if (key === "socialLinks" || key === "amenities") {
      if (
        !Array.isArray(value) ||
        value.length > 10 ||
        new Set(value).size !== value.length ||
        value.some(
          (v) =>
            typeof v !== "string" ||
            !v.trim() ||
            v.length > (key === "socialLinks" ? 500 : 100),
        )
      )
        fail();
      if (value.some((v) => forbiddenText.test(v))) fail();
      const normalized =
        key === "socialLinks"
          ? value.map((v) => normalizeResidentSocialUrl(v))
          : value;
      if (new Set(normalized).size !== normalized.length) fail();
      clean[key] = [...normalized];
    } else if (key === "education" || key === "propertyEvidence") {
      if (!Array.isArray(value) || value.length > 10) fail();
      for (const doc of value)
        if (
          !record(doc) ||
          Object.keys(doc).some(
            (k) =>
              !["kind", "fileId", "mimeType", "size", "caption"].includes(k),
          ) ||
          !["kind", "fileId", "mimeType", "size"].every((k) => k in doc) ||
          !["photo", "document"].includes(String(doc.kind)) ||
          typeof doc.fileId !== "string" ||
          !/^[A-Za-z0-9_-]{1,512}$/u.test(doc.fileId) ||
          (doc.mimeType !== null &&
            !["image/jpeg", "image/png", "application/pdf"].includes(
              String(doc.mimeType),
            )) ||
          (doc.kind === "photo" &&
            doc.mimeType !== null &&
            doc.mimeType !== "image/jpeg") ||
          (doc.size !== null &&
            (!Number.isSafeInteger(doc.size) ||
              Number(doc.size) < 1 ||
              Number(doc.size) > 20 * 1024 * 1024)) ||
          (doc.caption !== undefined &&
            (typeof doc.caption !== "string" ||
              doc.caption.length > 3000 ||
              /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(doc.caption)))
        )
          fail();
      clean[key] = value.map((v) => ({ ...v }));
    } else fail();
  }
  const result = { ...draft, ...clean } as ResidentDraft;
  if (clearPrimary) delete result.primaryRole;
  if (
    result.primaryRole &&
    result.roles &&
    !result.roles.includes(result.primaryRole)
  )
    fail();
  if (
    new TextEncoder().encode(JSON.stringify(result)).length >
    RESIDENT_DRAFT_MAX_BYTES
  )
    throw new Error("resident_draft_too_large");
  return result;
}
export function residentForm(
  draft: ResidentDraft,
  policy: ResidentPolicy = residentPolicy,
) {
  const required: ResidentField[] = [
    "roles",
    "primaryRole",
    "category",
    "tax",
    "city",
    "socialLinks",
    "motivation",
  ];
  if (draft.roles?.includes("EXPERT")) {
    required.push("specialization", "averageCheckMinor");
    if (policy.education === "required") required.push("education");
  }
  if (draft.roles?.includes("CENTER"))
    required.push("propertyEvidence", "capacity", "amenities");
  if (draft.roles?.some((r) => r === "ESOTERIC" || r === "OTHER"))
    required.push("path", "cases");
  const visible = [
    ...new Set([
      ...required,
      ...(draft.roles?.includes("EXPERT") ? ["education" as const] : []),
    ]),
  ];
  const missing = required.filter(
    (k) =>
      draft[k] === undefined ||
      draft[k] === "" ||
      (Array.isArray(draft[k]) && (draft[k] as unknown[]).length === 0),
  );
  return {
    version: 1,
    policyVersion: policy.version,
    required,
    visible,
    missing,
    next: missing[0] ?? null,
    educationPolicy: policy.education,
    categoryCriteria: "pending_content" as const,
    reviewSignals:
      draft.averageCheckMinor && BigInt(draft.averageCheckMinor) > 1500000n
        ? ["average_check_over_15000"]
        : [],
  };
}
