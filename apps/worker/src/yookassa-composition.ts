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
  ExperimentalGatewayIpc,
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
  const direct = config.yookassa !== undefined;
  const gateway = config.yookassaGateway !== undefined;
  if (
    enabled !== (direct || gateway) ||
    (direct && gateway) ||
    enabled !== config.integrations.payments ||
    (direct &&
      (!["test", "live"].includes(config.yookassa!.mode) ||
        config.yookassa!.secretReference !== "env://YOOKASSA_SECRET_KEY")) ||
    (gateway &&
      (!["test", "live"].includes(config.yookassaGateway!.mode) ||
        !config.yookassaGateway!.workerConfigFile?.startsWith("/")))
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
    readonly gateway?: ExperimentalGatewayIpc;
  } = {},
) {
  validateYooKassaWorkerConfig(config);
  if (!config.features.yookassa) return undefined;
  if (options.reader !== undefined)
    throw new Error("yookassa_unguarded_reader_rejected");
  const control: YooKassaBoundControl = {
    accepting: true,
    credentialsUnavailable: false,
  };
  const stopping = new AbortController();
  const credentialsRevoked = new AbortController();
  const mode = (config.yookassa ?? config.yookassaGateway)!.mode;
  // Resolve only the approved reference. Never load a file or retain the env object.
  const secretKey = config.yookassa
    ? (options.env ?? process.env).YOOKASSA_SECRET_KEY
    : undefined;
  if (
    config.yookassa &&
    (!secretKey || secretKey.length < 8 || secretKey.length > 256)
  )
    throw new Error("yookassa_worker_credentials_unavailable");
  if (
    config.yookassaGateway &&
    !(options.gateway instanceof ExperimentalGatewayIpc)
  )
    throw new Error("yookassa_worker_gateway_unavailable");
  const transport = options.transport ?? ((url, init) => fetch(url, init));
  const client = config.yookassa
    ? createYooKassaClient(
        { mode, shopId: config.yookassa.shopId, secretKey: secretKey! },
        async (url, init) => {
          if (!control.accepting || control.credentialsUnavailable)
            throw new Error("yookassa_worker_unavailable");
          const remaining = (control.deadline ?? 0) - Date.now();
          if (remaining <= 0)
            throw new Error("yookassa_recovery_budget_exhausted");
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
      )
    : {
        getPayment: (id: string) => {
          if (!control.accepting || (control.deadline ?? 0) <= Date.now())
            throw new Error("yookassa_worker_unavailable");
          return options.gateway!.getPayment(
            id,
            AbortSignal.any([
              stopping.signal,
              AbortSignal.timeout(
                Math.max(1, (control.deadline ?? 0) - Date.now()),
              ),
            ]),
          );
        },
        getRefund: (id: string) => {
          if (!control.accepting || (control.deadline ?? 0) <= Date.now())
            throw new Error("yookassa_worker_unavailable");
          return options.gateway!.getRefund(
            id,
            AbortSignal.any([
              stopping.signal,
              AbortSignal.timeout(
                Math.max(1, (control.deadline ?? 0) - Date.now()),
              ),
            ]),
          );
        },
      };
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
