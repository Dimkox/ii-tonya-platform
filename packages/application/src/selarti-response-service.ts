import { createHash } from "node:crypto";

import { guardClientCopy } from "@ii-tonya/domain";

export type ProviderTextProposal = {
  readonly requestId: string;
  readonly dialogueId: string;
  readonly threadId: string;
  readonly text: string;
};

export type SelartiProposalAcceptResult =
  "accepted" | "duplicate" | "conflict" | "rejected" | "late";

export interface SelartiProposalRepository {
  accept(input: {
    readonly requestId: string;
    readonly dialogueId: string;
    readonly threadId: string;
    readonly tenantKey: string;
    readonly text: string;
    readonly responsePayloadHash: string;
    readonly receivedAt: string;
  }): Promise<SelartiProposalAcceptResult>;
}

const requestIdPattern = /^sha256:[0-9a-f]{64}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const control = /[\u0000-\u001F\u007F-\u009F]/u;
const secretOrToolMarkup =
  /(?:authorization\s*:\s*bearer|api[_-]?key\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----|<\/?tool_call>|\bsk-[A-Za-z0-9_-]{8,})/iu;
const urlPattern = /https?:\/\/[^\s<>()]+/giu;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function decodeProviderTextProposal(
  raw: unknown,
  options: {
    readonly allowedUrlHosts: readonly string[];
    readonly expectedDialogueId?: string;
  },
): ProviderTextProposal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("selarti_response_invalid_shape");
  const body = raw as Record<string, unknown>;
  if (
    !exactKeys(body, [
      "version",
      "requestId",
      "dialogueId",
      "threadId",
      "text",
    ]) ||
    body.version !== 1 ||
    typeof body.requestId !== "string" ||
    !requestIdPattern.test(body.requestId) ||
    typeof body.dialogueId !== "string" ||
    !uuidPattern.test(body.dialogueId) ||
    typeof body.threadId !== "string" ||
    body.threadId !== body.requestId ||
    typeof body.text !== "string" ||
    body.text.length < 1 ||
    body.text.length > 4_096 ||
    control.test(body.text) ||
    secretOrToolMarkup.test(body.text) ||
    (options.expectedDialogueId !== undefined &&
      body.dialogueId !== options.expectedDialogueId)
  ) {
    throw new Error("selarti_response_invalid_proposal");
  }
  if (!guardClientCopy(body.text).accepted) {
    throw new Error("selarti_response_copy_prohibited");
  }
  const allowed = new Set(
    options.allowedUrlHosts.map((host) => host.toLowerCase()),
  );
  for (const match of body.text.matchAll(urlPattern)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      throw new Error("selarti_response_url_invalid");
    }
    if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase()))
      throw new Error("selarti_response_url_forbidden");
  }
  return {
    requestId: body.requestId,
    dialogueId: body.dialogueId,
    threadId: body.threadId,
    text: body.text,
  };
}

export function createSelartiResponseService(deps: {
  readonly enabled: boolean;
  readonly tenantKey: string;
  readonly allowedUrlHosts: readonly string[];
  readonly clock: () => Date;
  readonly proposals: SelartiProposalRepository;
}) {
  return {
    async handle(raw: unknown): Promise<{
      readonly status:
        | "accepted"
        | "duplicate"
        | "conflict"
        | "rejected"
        | "late"
        | "unavailable";
    }> {
      if (!deps.enabled) return { status: "unavailable" };
      let proposal: ProviderTextProposal;
      try {
        proposal = decodeProviderTextProposal(raw, {
          allowedUrlHosts: deps.allowedUrlHosts,
        });
      } catch {
        return { status: "rejected" };
      }
      const responsePayloadHash = createHash("sha256")
        .update(
          JSON.stringify({
            version: 1,
            requestId: proposal.requestId,
            dialogueId: proposal.dialogueId,
            threadId: proposal.threadId,
            text: proposal.text,
          }),
        )
        .digest("hex");
      const status = await deps.proposals.accept({
        ...proposal,
        tenantKey: deps.tenantKey,
        responsePayloadHash,
        receivedAt: deps.clock().toISOString(),
      });
      return { status };
    },
  };
}
