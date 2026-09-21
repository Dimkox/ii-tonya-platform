import type { Logger } from "./logger.js";

/**
 * Node пишет неперехваченное исключение в stderr мимо санитизатора: вместе со стеком в
 * журнал инфраструктуры могут уйти строка подключения, тело запроса или путь с секретом.
 * Хелпер перекладывает оба случая через логгер и оставляет процессу предсказуемый финал.
 */
export type FatalHandlerDeps = {
  readonly logger: Logger;
  /** Инжектируется ради тестов: реальный процесс завершается, тестовый — нет. */
  readonly exit?: (code: number) => void;
  readonly onFatal?: (
    error: unknown,
    kind: "uncaughtException" | "unhandledRejection",
  ) => void;
};

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

export function installFatalProcessLogging(
  deps: FatalHandlerDeps,
  target: {
    on(event: string, listener: (error: unknown) => void): unknown;
    removeListener(event: string, listener: (error: unknown) => void): unknown;
  } = process,
): () => void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const onException = (error: unknown) => {
    deps.onFatal?.(error, "uncaughtException");
    deps.logger.error(
      { err: asError(error), fatal: "uncaughtException" },
      "uncaught exception, stopping the process",
    );
    exit(1);
  };

  const onRejection = (reason: unknown) => {
    deps.onFatal?.(reason, "unhandledRejection");
    deps.logger.error(
      { err: asError(reason), fatal: "unhandledRejection" },
      "unhandled promise rejection, stopping the process",
    );
    exit(1);
  };

  target.on("uncaughtException", onException);
  target.on("unhandledRejection", onRejection);

  return () => {
    target.removeListener("uncaughtException", onException);
    target.removeListener("unhandledRejection", onRejection);
  };
}
