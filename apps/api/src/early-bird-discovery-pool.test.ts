import { createServer } from "node:net";
import { expect, it } from "vitest";
import { createEarlyBirdDiscoveryPool } from "./early-bird-discovery-pool.js";
/** A tiny local handshake peer, not a database: no SQL or financial facts are
 * executed. The real node-postgres Pool must enforce bounded checkout. */
it("times out saturated discovery checkout and releases it without affecting a held client", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () =>
      socket.write(
        Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("test_listener_missing");
  const db = createEarlyBirdDiscoveryPool(
    `postgresql://synthetic@127.0.0.1:${address.port}/synthetic?sslmode=disable`,
  );
  const connect = () => db.$client.connect();
  let held: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    held = await connect();
    const before = Date.now();
    await expect(db.$client.connect()).rejects.toThrow(/timeout/iu);
    expect(Date.now() - before).toBeLessThan(6500);
    expect(db.$client.waitingCount).toBe(0);
    held.release();
    held = undefined;
    const next = await db.$client.connect();
    next.release();
  } finally {
    held?.release();
    await db.$client.end();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
it("still closes database lifecycle when HTTP shutdown fails", async () => {
  const { closeServer } = await import("./server.js");
  const closed: string[] = [];
  await expect(
    closeServer(
      {
        close: async () => {
          closed.push("http");
          throw new Error("http drain failed");
        },
      } as never,
      {
        close: async () => {
          closed.push("databases");
        },
      } as never,
      {} as never,
    ),
  ).rejects.toThrow("http drain failed");
  expect(closed).toEqual(["http", "databases"]);
});
