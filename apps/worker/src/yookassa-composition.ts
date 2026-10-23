import type { loadEnv } from "@ii-tonya/config";
import {
  PostgresExpertResidencyProviderInboxRepository,
  PostgresYooKassaOperationRepository,
  type DrizzleDb,
} from "@ii-tonya/db";
import {
  createYooKassaClient,
  YooKassaPaymentVerifier,
  YooKassaTerminalError,
  type YooKassaTransport,
  type YooKassaClient,
  type YooKassaMode,
} from "@ii-tonya/integrations";
import {
  runYooKassaBoundReconciliation,
  isYooKassaCredentialFailure,
  type ExpertResidencyProviderReader,
  type YooKassaBoundControl,
} from "@ii-tonya/worker";

type Config = ReturnType<typeof loadEnv>;
export type YooKassaAuditReaderFactory = (
  client: Pick<YooKassaClient, "getPayment">,
  mode: YooKassaMode,
) => ExpertResidencyProviderReader;
export function validateYooKassaWorkerConfig(config: Config): void {
  const enabled = config.features.yookassa === true;
  if (
    enabled !== (config.yookassa !== undefined) ||
    enabled !== config.integrations.payments ||
    (enabled &&
      (!config.yookassa ||
        !["test", "live"].includes(config.yookassa.mode) ||
        config.yookassa.secretReference !== "env://YOOKASSA_SECRET_KEY"))
  )
    throw new Error("yookassa_worker_configuration_invalid");
}

export function createYooKassaWorkerComposition(
  config: Config,
  db: DrizzleDb,
  options: {
    readonly transport?: YooKassaTransport;
    readonly env?: NodeJS.ProcessEnv;
    readonly reader?: ExpertResidencyProviderReader;
    readonly readerFactory?: YooKassaAuditReaderFactory;
  } = {},
) {
  validateYooKassaWorkerConfig(config);
  if (!config.features.yookassa || !config.yookassa) return undefined;
  if (options.reader !== undefined)
    throw new Error("yookassa_unguarded_reader_rejected");
  const control: YooKassaBoundControl = {
    accepting: true,
    credentialsUnavailable: false,
  };
  const stopping = new AbortController();
  const credentialsRevoked = new AbortController();
  const mode = config.yookassa.mode;
  // Resolve only the approved reference. Never load a file or retain the env object.
  const secretKey = (options.env ?? process.env).YOOKASSA_SECRET_KEY;
  if (!secretKey || secretKey.length < 8 || secretKey.length > 256)
    throw new Error("yookassa_worker_credentials_unavailable");
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const client = createYooKassaClient(
    { mode, shopId: config.yookassa.shopId, secretKey },
    async (url, init) => {
      if (!control.accepting || control.credentialsUnavailable)
        throw new Error("yookassa_worker_unavailable");
      const remaining = (control.deadline ?? 0) - Date.now();
      if (remaining <= 0) throw new Error("yookassa_recovery_budget_exhausted");
      const response = await transport(url, {
        ...init,
        signal: AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          stopping.signal,
          credentialsRevoked.signal,
          AbortSignal.timeout(remaining),
        ]),
      });
      if (response.status === 401 || response.status === 403) {
        control.credentialsUnavailable = true;
        credentialsRevoked.abort();
      }
      return response;
    },
  );
  const operations = new PostgresYooKassaOperationRepository(db);
  const verifier = new YooKassaPaymentVerifier(client, operations);
  const inbox = new PostgresExpertResidencyProviderInboxRepository(db);
  // Every audit GET crosses the same admission and cancellation boundary.
  const auditReader = options.readerFactory?.(
    Object.freeze({ getPayment: client.getPayment }),
    mode,
  );
  const unavailableReason = () =>
    control.credentialsUnavailable
      ? "credentials_unavailable"
      : !control.accepting
        ? "closing"
        : control.deadline !== undefined && Date.now() >= control.deadline
          ? "budget_exhausted"
          : undefined;
  return {
    runOnce: () =>
      runYooKassaBoundReconciliation({
        enabled: true,
        mode,
        limit: 25,
        control,
        operations,
        verifier,
        deliver: (event) =>
          event.kind === "settled" ? inbox.settle(event) : inbox.reverse(event),
      }),
    stopAccepting: () => {
      control.accepting = false;
      stopping.abort();
    },
    unavailableReason,
    // Terminal auditing is an optional existing capability, not bound recovery.
    reader: {
      async readPayments(command) {
        if (unavailableReason() !== undefined || !auditReader)
          return { kind: "disabled" as const };
        try {
          return await auditReader.readPayments(command);
        } catch (error) {
          if (isYooKassaCredentialFailure(error)) {
            control.credentialsUnavailable = true;
            credentialsRevoked.abort();
          }
          if (unavailableReason() !== undefined)
            return { kind: "disabled" as const };
          throw new YooKassaTerminalError(
            "yookassa_terminal_audit_unavailable",
          );
        }
      },
    } satisfies ExpertResidencyProviderReader,
  };
}
