import { isIP, SocketAddress } from "node:net";
import type { FastifyRequest } from "fastify";

function normalizedIp(value: unknown): string {
  if (typeof value !== "string" || value.includes("%")) return "";
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return "";
  const address = new SocketAddress({ address: value, family: "ipv6" }).address;
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

/** Trust only the dedicated local nginx socket and its single overwritten header. */
export function effectivePeerAddress(request: FastifyRequest): string {
  const socket = normalizedIp(request.raw.socket.remoteAddress);
  if (socket !== "127.0.0.1" && socket !== "::1") return "";

  const raw = request.raw.rawHeaders;
  if (!Array.isArray(raw) || raw.length % 2 !== 0) return "";
  let value: string | undefined;
  for (let index = 0; index < raw.length; index += 2) {
    const name = raw[index];
    const candidate = raw[index + 1];
    if (typeof name !== "string" || typeof candidate !== "string") return "";
    if (name.toLowerCase() !== "x-real-ip") continue;
    if (value !== undefined) return "";
    value = candidate;
  }
  // Raw occurrences are authoritative; a normalized array must never hide one.
  if (Array.isArray(request.headers["x-real-ip"])) return "";
  return normalizedIp(value);
}
