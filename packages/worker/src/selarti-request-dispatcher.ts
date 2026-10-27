import {
  clientConsentAuthoritySchema,
  matchesClientDispatchAdmission,
  type ClientDispatchAdmissionGate,
} from "@ii-tonya/contracts";
import type {
  OutboxDispatcher,
  OutboxReconciler,
  DispatchOutcome,
} from "./outbox-runner.js";

export interface SelartiRequestTransport {
  /** Trusted composition owns provider/thread/tenant mapping. No stamp crosses this boundary. */
  request(input: {
    requestId: string;
    dialogueId: string;
    userId: string;
    correlationId: string;
    text: string;
    locale: string;
    promptVersion: string;
    deadline: string;
  }): Promise<DispatchOutcome>;
}
export function createSelartiRequestDispatcher(deps: {
  transport: SelartiRequestTransport;
  admissionGate: ClientDispatchAdmissionGate;
}): OutboxDispatcher & OutboxReconciler {
  return {
    async dispatch(message, admission) {
      if (
        message.topic !== "selarti.request.v1" ||
        !message.payload ||
        typeof message.payload !== "object" ||
        Array.isArray(message.payload)
      )
        return { kind: "terminal", reasonCode: "invalid_payload" };
      const p = message.payload as Record<string, unknown>;
      const keys = [
        "requestId",
        "dialogueId",
        "userId",
        "correlationId",
        "text",
        "locale",
        "promptVersion",
        "deadline",
        "consentAuthority",
      ];
      if (
        Object.keys(p).sort().join("|") !== keys.sort().join("|") ||
        keys
          .filter((k) => k !== "consentAuthority")
          .some(
            (k) => typeof p[k] !== "string" || (p[k] as string).length === 0,
          ) ||
        !clientConsentAuthoritySchema.safeParse(p.consentAuthority).success ||
        p.requestId !== message.reconciliationKey ||
        (p.text as string).length > 4096
      )
        return { kind: "terminal", reasonCode: "invalid_payload" };
      if (!matchesClientDispatchAdmission(message, admission) || !admission)
        return { kind: "terminal", reasonCode: "local_source_invalid" };
      try {
        if (!(await deps.admissionGate.consume(message, admission)))
          return { kind: "terminal", reasonCode: "local_source_invalid" };
      } catch {
        return { kind: "terminal", reasonCode: "local_source_invalid" };
      }
      return deps.transport.request({
        requestId: p.requestId as string,
        dialogueId: p.dialogueId as string,
        userId: p.userId as string,
        correlationId: p.correlationId as string,
        text: p.text as string,
        locale: p.locale as string,
        promptVersion: p.promptVersion as string,
        deadline: p.deadline as string,
      });
    },
    async reconcile() {
      return "still_unknown";
    },
  };
}
