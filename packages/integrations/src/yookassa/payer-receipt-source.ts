import type { YooKassaReceiptContactPort } from "./operation-port.js";

/** Purchase authority is opaque; this source never claims address verification. */
export function createPayerReceiptSource(
  reader: YooKassaReceiptContactPort,
): YooKassaReceiptContactPort {
  return {
    async receiptContactForOrder(orderId) {
      try {
        return await reader.receiptContactForOrder(orderId);
      } catch {
        return null;
      }
    },
  };
}
