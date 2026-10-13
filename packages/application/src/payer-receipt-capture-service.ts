import {
  payerReceiptCaptureRequestSchema,
  type PayerReceiptCaptureRequest,
} from "@ii-tonya/contracts";
import type { ExpertPrincipal } from "./expert-referral-service.js";
export function createPayerReceiptCaptureService(deps: {
  ownerUserId(expertId: string): Promise<string | undefined>;
  capture(
    input: PayerReceiptCaptureRequest & { userId: string },
  ): Promise<{ receiptContactId: string; quoteId: string; expiresAt: string }>;
}) {
  return {
    async capture(principal: ExpertPrincipal, request: unknown) {
      const parsed = payerReceiptCaptureRequestSchema.safeParse(request);
      if (!parsed.success) return { kind: "invalid_request" as const };
      try {
        if (
          !principal.authenticated ||
          (await deps.ownerUserId(principal.expertId)) !== principal.userId
        )
          return { kind: "forbidden" as const };
        return await deps.capture({ ...parsed.data, userId: principal.userId });
      } catch (e) {
        return {
          kind:
            e instanceof Error &&
            "code" in e &&
            e.code === "PAYER_RECEIPT_CONFLICT"
              ? ("command_rejected" as const)
              : ("service_unavailable" as const),
        };
      }
    },
  };
}
export type PayerReceiptCaptureService = ReturnType<
  typeof createPayerReceiptCaptureService
>;
