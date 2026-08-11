import { createHash } from "node:crypto";
import {
  classifyApprovedTrackedScopeContent as classifyApprovedTrackedScopeContentCore,
  type PaymentScopeProbe,
} from "./payment-scope-boundary-core.js";

export * from "./payment-scope-boundary-core.js";

const EXPERT_RESIDENCY_DB_GATE_PATH = ".github/workflows/db-gate.yml";
const EXPERT_RESIDENCY_DB_GATE_SHA256 =
  "9b6ee77a2e46fe452cf31cfae3111475dd8a1a0fd27307ee24251f2ab728bdf8";

const normalizePath = (path: string): string =>
  path.replaceAll("\\", "/").toLowerCase();

export const classifyApprovedTrackedScopeContent = ({
  path: rawPath,
  content,
}: PaymentScopeProbe): readonly string[] => {
  const path = normalizePath(rawPath);
  if (path !== EXPERT_RESIDENCY_DB_GATE_PATH) {
    return classifyApprovedTrackedScopeContentCore({ path: rawPath, content });
  }

  const normalizedContent = content.replace(/\r\n?/gu, "\n");
  const actualHash = createHash("sha256")
    .update(normalizedContent, "utf8")
    .digest("hex");
  return actualHash === EXPERT_RESIDENCY_DB_GATE_SHA256
    ? []
    : [`approved tracked scope hash mismatch: ${actualHash}`];
};
