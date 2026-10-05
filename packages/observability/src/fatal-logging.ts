import type { Logger } from "./logger.js";
import { classifyFailure } from "./telemetry-schema.js";

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

export function installFatalProcessLogging(
  deps: FatalHandlerDeps,
  target: {
    on(event: string, listener: (error: unknown) => void): unknown;
    removeListener(event: string, listener: (error: unknown) => void): unknown;
  } = process,
): () => void {
  const exit = deps.exit ?? ((code: number) => process.exit(code));

  const fatal = (
    error: unknown,
    kind: "uncaughtException" | "unhandledRejection",
  ) => {
    try {
      try {
        deps.onFatal?.(error, kind);
      } catch {
        /* Cleanup cannot prevent exit. */
      }
      try {
        deps.logger.error({
          event: "process_fatal",
          fatal: kind,
          failureClass: classifyFailure(error),
        });
      } catch {
        /* A broken sink cannot prevent exit or print the raw exception. */
      }
    } finally {
      exit(1);
    }
  };
  const onException = (error: unknown) => fatal(error, "uncaughtException");
  const onRejection = (reason: unknown) => fatal(reason, "unhandledRejection");

  target.on("uncaughtException", onException);
  target.on("unhandledRejection", onRejection);

  return () => {
    target.removeListener("uncaughtException", onException);
    target.removeListener("unhandledRejection", onRejection);
  };
}
