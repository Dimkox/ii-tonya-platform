import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export interface SafeDocumentParser {
  parse(input: {
    bytes: Uint8Array;
    type: "pdf" | "docx";
    signal: AbortSignal;
  }): Promise<{ source: "pdf" | "docx"; content: string } | null>;
}
/** Disabled unless an explicitly configured isolated Python runtime is supplied.
 * The native Node worker image is deliberately not a parser runtime. */
export function createSafeDocumentParser(options: {
  enabled: boolean;
  pythonExecutable?: string;
  helperPath?: string;
  timeoutMs?: number;
  warning?: (reason: "document_parse_unavailable") => void;
}): SafeDocumentParser {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw new Error("document_parser_configuration_invalid");
  let active = false;
  return {
    async parse(input) {
      const warn = () => {
        try {
          options.warning?.("document_parse_unavailable");
        } catch {
          /* Warnings never fail a user workflow. */
        }
        return null;
      };
      if (
        !options.enabled ||
        !options.pythonExecutable ||
        active ||
        input.signal.aborted ||
        !(input.bytes instanceof Uint8Array) ||
        input.bytes.byteLength < 1 ||
        input.bytes.byteLength > 5 * 1024 * 1024 ||
        !["pdf", "docx"].includes(input.type)
      )
        return warn();
      const bytes = Buffer.from(input.bytes);
      active = true;
      try {
        return await new Promise<{
          source: "pdf" | "docx";
          content: string;
        } | null>((resolve) => {
          const child = spawn(
            options.pythonExecutable!,
            [
              "-I",
              options.helperPath ??
                fileURLToPath(new URL("../parser/helper.py", import.meta.url)),
              input.type,
            ],
            {
              stdio: ["pipe", "pipe", "pipe"],
              env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
            },
          );
          let output = Buffer.alloc(0),
            failed = false;
          const kill = () => {
            failed = true;
            child.kill("SIGKILL");
          };
          const timer = setTimeout(kill, timeoutMs);
          input.signal.addEventListener("abort", kill, { once: true });
          // Cancellation cannot race between the preflight and listener registration.
          if (input.signal.aborted) kill();
          child.stdout.on("data", (chunk: Buffer) => {
            if (output.length + chunk.length > 400000) kill();
            else output = Buffer.concat([output, chunk]);
          });
          child.stderr.on("data", kill);
          child.stdin.on("error", () => {
            failed = true;
          });
          child.on("error", () => {
            failed = true;
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            input.signal.removeEventListener("abort", kill);
            if (failed || code !== 0 || input.signal.aborted) {
              resolve(warn());
              return;
            }
            try {
              const result: unknown = JSON.parse(output.toString("utf8"));
              if (
                !result ||
                typeof result !== "object" ||
                Array.isArray(result)
              ) {
                resolve(warn());
                return;
              }
              const record = result as Record<string, unknown>;
              if (
                Object.keys(record).sort().join() !== "content,source" ||
                record.source !== input.type ||
                typeof record.content !== "string" ||
                record.content.trim().length < 50 ||
                Buffer.byteLength(record.content) > 64000 ||
                Buffer.byteLength(
                  JSON.stringify({
                    source: input.type,
                    content: record.content,
                  }),
                ) > 90000 ||
                /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(
                  record.content,
                )
              ) {
                resolve(warn());
                return;
              }
              resolve({ source: input.type, content: record.content.trim() });
            } catch {
              resolve(warn());
            }
          });
          child.stdin.end(bytes);
        });
      } catch {
        return warn();
      } finally {
        active = false;
      }
    },
  };
}
