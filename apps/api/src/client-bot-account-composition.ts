import {
  createClientBotAccountReadService,
  type ClientBotAccountReply,
} from "@ii-tonya/application";
import {
  PostgresClientBotAccountReadRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  assertClientAccountQueriesConfig,
  type RuntimeConfig,
} from "@ii-tonya/config";
export interface ClientBotAccountCapability {
  botId: string;
  botKey: string;
  service: { handle(raw: unknown): Promise<ClientBotAccountReply> };
}
export function assertClientBotAccountCapability(
  config: RuntimeConfig,
  cap: ClientBotAccountCapability | undefined,
): void {
  assertClientAccountQueriesConfig(config);
  if (config.features.clientAccountQueries !== true) return;
  if (
    !cap ||
    cap.botId !== config.clientAccountQueries?.botId ||
    cap.botKey !== config.clientAccountQueries?.botKey ||
    typeof cap.service?.handle !== "function"
  )
    throw Error("client_account_queries_capability_required");
}
export function createClientBotAccountComposition(
  db: DrizzleDb,
  config: RuntimeConfig,
): ClientBotAccountCapability | undefined {
  assertClientAccountQueriesConfig(config);
  if (config.features.clientAccountQueries !== true) return undefined;
  const s = config.clientAccountQueries!;
  return {
    botId: s.botId,
    botKey: s.botKey,
    service: createClientBotAccountReadService({
      botId: s.botId,
      botKey: s.botKey,
      repository: new PostgresClientBotAccountReadRepository(db, s),
    }),
  };
}
