import { createConnection } from "node:net";
export interface IsolatedDocumentParser {
  parse(input: {
    bytes: Uint8Array;
    type: "pdf" | "docx" | "jpeg" | "png";
    signal: AbortSignal;
  }): Promise<{ content: string; source: string } | null>;
}
/** Connects to an already provisioned isolated peer; never launches Docker or a host parser. */
export function createIsolatedDocumentParser(options: {
  socketPath: string;
  ocr: boolean;
  timeoutMs?: number;
}): IsolatedDocumentParser {
  const timeout = options.timeoutMs ?? 10000;
  if (
    !options.socketPath.startsWith("/") ||
    options.socketPath.length > 100 ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 10000
  )
    throw Error("isolated_parser_configuration");
  let active = false;
  return {
    async parse(input) {
      if (
        active ||
        input.signal.aborted ||
        input.bytes.byteLength < 1 ||
        input.bytes.byteLength > 5 * 1024 * 1024 ||
        !["pdf", "docx", "jpeg", "png"].includes(input.type)
      )
        return null;
      active = true;
      try {
        return await new Promise<{ source: string; content: string } | null>(
          (resolve) => {
            const socket = createConnection({ path: options.socketPath });
            let settled = false;
            const chunks: Buffer[] = [];
            let count = 0;
            const done = (
              value: { source: string; content: string } | null,
            ) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              input.signal.removeEventListener("abort", abort);
              socket.destroy();
              resolve(value);
            };
            const abort = () => done(null),
              timer = setTimeout(abort, timeout);
            input.signal.addEventListener("abort", abort, { once: true });
            if (input.signal.aborted) abort();
            socket.on("error", abort);
            socket.on("connect", () => {
              socket.write(
                JSON.stringify({
                  type: input.type,
                  length: input.bytes.byteLength,
                  ocr: options.ocr,
                }) + "\n",
              );
              socket.write(input.bytes);
            });
            socket.on("data", (chunk: Buffer) => {
              count += chunk.length;
              if (count > 90001) {
                abort();
                return;
              }
              chunks.push(chunk);
            });
            socket.on("end", () => {
              try {
                const r: unknown = JSON.parse(Buffer.concat(chunks).toString());
                if (!r || typeof r !== "object" || Array.isArray(r))
                  return done(null);
                const p = r as Record<string, unknown>;
                if (
                  Object.keys(p).sort().join() !== "content,source" ||
                  p.source !== input.type ||
                  typeof p.content !== "string" ||
                  p.content.trim().length < 50 ||
                  Buffer.byteLength(p.content) > 64000 ||
                  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(
                    p.content,
                  )
                )
                  return done(null);
                done({ source: input.type, content: p.content.trim() });
              } catch {
                done(null);
              }
            });
          },
        );
      } finally {
        active = false;
      }
    },
  };
}
