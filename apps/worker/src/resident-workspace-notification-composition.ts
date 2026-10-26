import { createWorkspaceNotificationTransport } from "@ii-tonya/integrations";
import { assertExpertCardConfig, type RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresResidentWorkspaceRepository,
  type DrizzleDb,
  type WorkspaceNotifier,
} from "@ii-tonya/db";
import { createExpertCardMaterialsRunner } from "@ii-tonya/worker";
/** A configured, bounded promo transport is required; worker never invents a delivery. */
export function createResidentWorkspaceNotificationLifecycle(
  config: RuntimeConfig,
  db: DrizzleDb,
  notifier?: WorkspaceNotifier,
) {
  assertExpertCardConfig(config);
  if (config.features.residentWorkspaceNotifications !== true) return undefined;
  if (
    config.features.expertCard !== true ||
    !config.expertCard ||
    !config.expertApplicant
  )
    throw new Error("resident_workspace_notifier_required");
  const settings = config.expertCard;
  const promo = config.expertApplicant;
  const configured =
    notifier ??
    (promo.botToken
      ? createWorkspaceNotificationTransport({
          token: promo.botToken,
          botKey: promo.botKey,
          workBotUsername: settings.workBotUsername,
        })
      : undefined);
  if (!configured) throw new Error("resident_workspace_notifier_required");
  const bound: WorkspaceNotifier = {
    send(input) {
      if (input.botId !== promo.botId || input.botKey !== promo.botKey)
        return Promise.reject(new Error("workspace_promo_scope_unavailable"));
      return configured.send(input);
    },
  };
  return createExpertCardMaterialsRunner({
    enabled: true,
    repository: new PostgresResidentWorkspaceRepository(db, {
      messagingConsentPolicyVersion: settings.messagingConsentPolicyVersion,
      workBotId: settings.workBotId,
      workBotKey: settings.workBotKey,
      workBotUsername: settings.workBotUsername,
      notifier: bound,
    }),
  });
}
