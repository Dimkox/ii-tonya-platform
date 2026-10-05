import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
  type ChildLoggerOptions,
  type Bindings,
} from "pino";
import { ownData, projectBindings, projectLog } from "./telemetry-schema.js";

export { classifyFailure } from "./telemetry-schema.js";
export const redactProviderUrl = (value: unknown): string => {
  void value;
  return "[REDACTED]";
};
export const sanitizeTelemetry = (value: unknown): unknown => projectLog(value);

function protectBindings(
  logger: Logger,
  child: (
    bindings: Bindings,
    options?: ChildLoggerOptions,
  ) => Logger = logger.child,
  setBindings: Logger["setBindings"] = logger.setBindings,
): Logger {
  logger.child = ((bindings: unknown, options?: ChildLoggerOptions) => {
    const level = ownData(options, "level");
    const safeOptions: ChildLoggerOptions = {};
    if (
      typeof level === "string" &&
      ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(
        level,
      )
    )
      safeOptions.level = level;
    // Pino resets bindings formatters in child(); sanitize BEFORE every call.
    // Child serializers, formatters, custom levels and mixins cannot cross here.
    return protectBindings(
      child.call(logger, projectBindings(bindings), safeOptions),
      child,
      setBindings,
    );
    // Keep Pino's generic interface for Fastify; custom level definitions are
    // deliberately excluded at runtime, just like custom serializers.
  }) as unknown as Logger["child"];
  logger.setBindings = (bindings) =>
    setBindings.call(logger, projectBindings(bindings));
  return logger;
}

export function createLogger(destination?: NodeJS.WritableStream): Logger {
  const target: DestinationStream | undefined =
    destination === undefined
      ? undefined
      : {
          write(chunk: string) {
            queueMicrotask(() => destination.write(chunk));
          },
        };
  const options: LoggerOptions = {
    level: "info",
    base: null,
    hooks: {
      logMethod(args, method) {
        // Only freshly projected data reaches Pino, including its serializers.
        method.call(this, projectLog(args[0], args[1]));
      },
    },
  };
  return protectBindings(
    target === undefined ? pino(options) : pino(options, target),
  );
}

export type { Logger } from "pino";
