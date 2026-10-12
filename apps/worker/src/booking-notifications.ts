import type { RuntimeConfig } from "@ii-tonya/config";
import { randomUUID } from "node:crypto";
import {
  PostgresBookingNotificationRepository,
  PostgresBookingNotificationCallbackRepository,
  sql,
  type DrizzleDb,
  type BookingNotificationOutcome,
} from "@ii-tonya/db";
import {
  createBookingNotificationRunner,
  renderBookingNotification,
} from "@ii-tonya/worker";
import {
  createBookingCallbackVault,
  issueCallback,
  authenticateCallbackToken,
  createBookingNotificationTransport,
} from "@ii-tonya/integrations";

export async function createBookingNotificationRuntime(
  config: RuntimeConfig,
  db: DrizzleDb,
) {
  const flags = config.bookingNotifications;
  if (
    !flags ||
    (!flags.recoveryEnabled && !flags.sendEnabled && !flags.admissionEnabled)
  )
    return undefined;
  const invalid = () =>
    new Error("booking_notification_runtime_configuration_invalid");
  const botKey = config.clientTelegramBotKey;
  if (
    !flags.recoveryEnabled ||
    !botKey ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(botKey)
  )
    throw invalid();
  if (
    (flags.sendEnabled || flags.admissionEnabled) &&
    (!config.bookingCallbacks ||
      config.features.bookingCallbacks !== true ||
      !config.clientTelegramBotToken ||
      !config.telegramWebhookSecret)
  )
    throw invalid();
  if (flags.admissionEnabled && !config.clientMessagingConsentPolicyVersion)
    throw invalid();
  const material = config.bookingCallbacks;
  const vault = material ? createBookingCallbackVault(material) : undefined;
  const hmac = material ? Uint8Array.from(material.hmacKey) : undefined;
  const ledger = new PostgresBookingNotificationRepository(
    db,
    botKey,
    vault && hmac
      ? {
          render: renderBookingNotification,
          open: vault.open,
          authenticateToken(token) {
            try {
              return authenticateCallbackToken(token, hmac);
            } catch {
              return null;
            }
          },
        }
      : undefined,
  );
  if (flags.sendEnabled || flags.admissionEnabled) {
    // Read-only preflight: provisioning and resume are explicit operations.
    const controls = await db.execute(
      sql`select bot_key from booking_notification_bot_controls where bot_key=${botKey}`,
    );
    if (controls.rows.length !== 1)
      throw new Error("booking_notification_control_required");
  }
  const callbacks =
    vault && hmac
      ? new PostgresBookingNotificationCallbackRepository(db, botKey, {
          ...vault,
          async issue(claims) {
            let tokenHash = "";
            const token = await issueCallback(claims, hmac, {
              async put(hash) {
                tokenHash = hash;
              },
              async peek() {
                return null;
              },
              async consumeIfValid() {
                return null;
              },
            });
            return { token, tokenHash };
          },
        })
      : {
          async issueApprovalPair(): Promise<never> {
            throw invalid();
          },
        };
  const transport = flags.sendEnabled
    ? createBookingNotificationTransport({
        botKey,
        token: config.clientTelegramBotToken!,
      })
    : {
        async sendPrepared(): Promise<never> {
          throw invalid();
        },
      };
  return createBookingNotificationRunner({
    workerId: `booking-${randomUUID()}`,
    sendEnabled: flags.sendEnabled,
    callbacks,
    transport,
    repository: {
      capturePending: (limit) =>
        flags.admissionEnabled
          ? ledger.capturePending(limit)
          : Promise.resolve(0),
      recoverExpired: (limit) => ledger.recoverExpired(limit),
      claimDeliveries: (limit, workerId) =>
        ledger.claimDeliveries(limit, workerId),
      admitPrepared: (claim) => ledger.admitPrepared(claim),
      resolveReceipt: (attemptId, receipt) =>
        ledger.resolveReceipt(attemptId, receipt),
      recordOutcome: (attemptId, outcome) => {
        const allowed = [
          "delivery_uncertain",
          "request_invalid",
          "request_expired",
          "bot_mismatch",
          "bot_rejected",
          "recipient_rejected",
        ];
        if ("reasonCode" in outcome && !allowed.includes(outcome.reasonCode))
          throw invalid();
        return ledger.recordOutcome(
          attemptId,
          outcome as BookingNotificationOutcome,
        );
      },
    },
  });
}
