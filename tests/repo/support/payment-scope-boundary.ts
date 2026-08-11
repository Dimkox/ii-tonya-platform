import { createHash } from "node:crypto";
import {
  classifyApprovedTrackedScopeContent as classifyApprovedTrackedScopeContentCore,
  type PaymentScopeProbe,
} from "./payment-scope-boundary-core.js";

export * from "./payment-scope-boundary-core.js";

const EXPERT_RESIDENCY_DB_GATE_PATH = ".github/workflows/db-gate.yml";
const EXPERT_RESIDENCY_DB_GATE_SHA256 =
  "9b6ee77a2e46fe452cf31cfae3111475dd8a1a0fd27307ee24251f2ab728bdf8";

const MAIN_NATIVE_AUTOMATION_BLOB_SHA1 = new Map<string, string>([
  [
    ".github/workflows/server-control.yml",
    "c65fa84ff8d00ae55413802e692b756b9ba4fb10",
  ],
  [
    ".github/workflows/server-native.yml",
    "d31d2fb6e9bd5e8ff8de100fed76946ad29eedf2",
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
