import { CLIENT_ASYNC_OUTBOX_TOPICS } from "@ii-tonya/worker";
import {
  createClientDispatchAdmissionGate,
  reconcileClientSelartiRequest,
  type DrizzleDb,
} from "@ii-tonya/db";
import type { TelegramTransport } from "@ii-tonya/integrations";
import {
  createTelegramSendTextDispatcher,
  createSelartiRequestDispatcher,
  type SelartiRequestTransport,
  type OutboxDispatcher,
  type OutboxReconciler,
} from "@ii-tonya/worker";
export type ClientAsyncCapabilities = {
  telegram: { transport: TelegramTransport; sendMessageUrl: URL };
  selarti?: SelartiRequestTransport;
};
export type ClientAsyncRegistry = OutboxDispatcher &
  OutboxReconciler & {
    botKey: string;
    topics:
      typeof CLIENT_ASYNC_OUTBOX_TOPICS | readonly ["telegram.send_text.v1"];
  };
export function createClientAsyncOutboxRegistry(
  db: DrizzleDb,
  botKey: string,
  capabilities: ClientAsyncCapabilities,
  includeSelarti: boolean,
): ClientAsyncRegistry {
  const admissionGate = createClientDispatchAdmissionGate(db);
  const telegram = createTelegramSendTextDispatcher({
    enabled: true,
    botKey,
    admissionGate,
    ...capabilities.telegram,
  });
  if (includeSelarti && !capabilities.selarti)
    throw new Error("selarti_delivery_capability_unavailable");
  const selarti = capabilities.selarti
    ? createSelartiRequestDispatcher({
        transport: capabilities.selarti,
        admissionGate,
      })
    : undefined;
  return {
    botKey,
    topics: includeSelarti
      ? CLIENT_ASYNC_OUTBOX_TOPICS
      : ["telegram.send_text.v1"],
    dispatch: (message, admission) =>
      message.topic === "telegram.send_text.v1"
        ? telegram.dispatch(message, admission)
        : message.topic === "selarti.request.v1" && includeSelarti && selarti
          ? selarti.dispatch(message, admission)
          : Promise.resolve({
              kind: "terminal",
              reasonCode: "invalid_payload",
            }),
    reconcile: (message) =>
      message.topic === "selarti.request.v1" && includeSelarti
        ? reconcileClientSelartiRequest(
            db,
            botKey,
            message.id,
            message.reconciliationKey,
          )
        : telegram.reconcile(message),
  };
}
