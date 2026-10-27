import type { RuntimeConfig } from "@ii-tonya/config";
import {
  PostgresResidentPrivateJobsRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createTelegramPreviewReader,
  createPrivateObjectStore,
  createTelegramDocumentReader,
  createVkWallReader,
  createIsolatedDocumentParser,
} from "@ii-tonya/integrations";
import { createResidentPrivateJobsRunner } from "@ii-tonya/worker";
export function createResidentPrivateJobsLifecycle(
  config: RuntimeConfig,
  db: DrizzleDb,
) {
  if (config.features.residentPrivateJobs !== true) return undefined;
  const settings = config.privateVerification,
    scope = config.expertApplicant;
  if (
    !settings ||
    !scope?.botToken ||
    config.features.expertVerificationForm !== true
  )
    throw Error("resident_private_capability_required");
  return createResidentPrivateJobsRunner({
    ...(settings.telegramPreview
      ? { telegramPreview: createTelegramPreviewReader() }
      : {}),
    repository: new PostgresResidentPrivateJobsRepository(db, scope),
    store: createPrivateObjectStore(settings),
    reader: createTelegramDocumentReader({
      botId: scope.botId,
      token: scope.botToken,
    }),
    ...(settings.parserSocket
      ? {
          parser: createIsolatedDocumentParser({
            socketPath: settings.parserSocket,
            ocr: settings.ocr,
          }),
        }
      : {}),
    ...(settings.vkToken && settings.vkTokenKind
      ? {
          social: createVkWallReader({
            token: settings.vkToken,
            tokenKind: settings.vkTokenKind,
          }),
        }
      : {}),
  });
}
