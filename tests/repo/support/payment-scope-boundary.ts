import { createHash } from "node:crypto";
import {
  classifyApprovedTrackedScopeContent as classifyApprovedTrackedScopeContentCore,
  type PaymentScopeProbe,
} from "./payment-scope-boundary-core.js";

export * from "./payment-scope-boundary-core.js";

const EXPERT_RESIDENCY_DB_GATE_PATH = ".github/workflows/db-gate.yml";
const EXPERT_RESIDENCY_DB_GATE_SHA256 =
  "7e057dc2975e1c65994cf802b87bf36cbf443e4fbf85122a957ea9ca3d3466f2";

const MAIN_NATIVE_AUTOMATION_BLOB_SHA1 = new Map<string, string>([
  [
    ".github/workflows/server-control.yml",
    "4aabdc39f4e5a19640dd1f71623cf27e643d58d3",
  ],
  [
    ".github/workflows/server-native.yml",
    "174cfe711bdb076466c016f15268198cf8e9bb8a",
  ],
  ["ops/server-command.sh", "d2668a5c4acc9dcf1b8068f3ad02d025946a24e9"],
  [
    "scripts/bootstrap-native-runner.sh",
    "a4ea7befe66b9eb3dd414b51e5f8f60d783519a6",
  ],
]);

const normalizePath = (path: string): string =>
  path.replaceAll("\\", "/").toLowerCase();

function normalizedContent(content: string): string {
  return content.replace(/\r\n?/gu, "\n");
}

function gitBlobSha1(content: string): string {
  const normalized = normalizedContent(content);
  const body = Buffer.from(normalized, "utf8");
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return createHash("sha1").update(header).update(body).digest("hex");
}

export const classifyApprovedTrackedScopeContent = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);

  const nativeAutomationSha = MAIN_NATIVE_AUTOMATION_BLOB_SHA1.get(path);
  if (nativeAutomationSha !== undefined) {
    const actualBlobSha = gitBlobSha1(content);
    return actualBlobSha === nativeAutomationSha
      ? []
      : [`approved tracked scope hash mismatch: git-blob:${actualBlobSha}`];
  }

  if (path !== EXPERT_RESIDENCY_DB_GATE_PATH) {
    return classifyApprovedTrackedScopeContentCore({ path: rawPath, content });
  }

  const actualHash = createHash("sha256")
    .update(normalizedContent(content), "utf8")
    .digest("hex");
  return actualHash === EXPERT_RESIDENCY_DB_GATE_SHA256
    ? []
    : [`approved tracked scope hash mismatch: ${actualHash}`];
};
