import { createConnection } from "node:net";
import type { SemanticHelper } from "@ii-tonya/contracts";
/** Only an already provisioned local socket, no process spawning or network model fetch. */
export function createIsolatedSemanticTags(socketPath: string): SemanticHelper {
  if (!socketPath.startsWith("/") || socketPath.length > 100)
    throw Error("semantic_socket_invalid");
  let active = false;
  return {
    async call(operation, payload = {}) {
      if (active) return null;
      const wire = JSON.stringify({ operation, ...payload }) + "\n";
      if (Buffer.byteLength(wire) > 10_000_000) return null;
      active = true;
      try {
        return await new Promise<Record<string, unknown> | null>((resolve) => {
          const socket = createConnection({ path: socketPath });
          const chunks: Buffer[] = [];
          let count = 0,
            settled = false;
          const done = (value: Record<string, unknown> | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(value);
          };
          const timer = setTimeout(
            () => done(null),
            operation === "recommend" ? 400 : 5000,
          );
          socket.on("error", () => done(null));
          socket.on("connect", () => socket.end(wire));
          socket.on("data", (chunk: Buffer) => {
            count += chunk.length;
            if (count > 10_000_000) return done(null);
            chunks.push(chunk);
          });
          socket.on("end", () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString());
              done(
                parsed.ok === true &&
                  parsed.result &&
                  typeof parsed.result === "object"
                  ? parsed.result
                  : null,
              );
            } catch {
              done(null);
            }
          });
        });
      } finally {
        active = false;
      }
    },
  };
}
