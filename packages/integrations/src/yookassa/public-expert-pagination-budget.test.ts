import { afterEach, expect, it, vi } from "vitest";
import { PublicExpertGatewayTransport } from "./public-expert-gateway.js";
import { ExperimentalGatewayIpc } from "./experimental-gateway-ipc.js";
import { createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
afterEach(() => vi.useRealTimers());
const window = {
  createdFrom: "2027-01-11T00:00:00Z",
  createdTo: "2027-01-12T00:00:00Z",
  scanKey: "request-1",
};
function fixture() {
  const pages: number[] = [];
  let active = 0;
  const transport = new PublicExpertGatewayTransport({
    async listPublicPage(
      _resource: unknown,
      input: { cursor?: string },
      signal?: AbortSignal,
    ) {
      const page = Number(input.cursor ?? 0);
      pages.push(page);
      active++;
      try {
        return await new Promise((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", stop);
            reject(Error("aborted"));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", stop);
            resolve({
              items: [{ id: `p${page}`, createdAt: "2027-01-11T12:00:00Z" }],
              ...(page === 9 ? {} : { nextCursor: String(page + 1) }),
            });
          }, 8000);
          if (signal?.aborted) stop();
          else signal?.addEventListener("abort", stop, { once: true });
        });
      } finally {
        active--;
      }
    },
  } as never);
  return { transport, pages, active: () => active };
}
it("aborts the underlying slow page at the complete scan budget and returns no partial binding evidence", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    abort = new AbortController();
  let done = false;
  const work = f.transport
    .listPayments({ ...window, signal: abort.signal } as never)
    .then((result) => {
      done = true;
      return result;
    });
  await vi.advanceTimersByTimeAsync(15000);
  abort.abort();
  await vi.advanceTimersByTimeAsync(0);
  const bounded = done;
  await vi.advanceTimersByTimeAsync(100000);
  const result = await work;
  expect(bounded).toBe(true);
  expect(result).toEqual({ complete: false, items: [] });
  expect(f.pages).toEqual([0, 1]);
  expect(f.active()).toBe(0);
});
it("resumes complete bounded discovery across turns instead of restarting a long scan forever", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let result: Awaited<ReturnType<typeof f.transport.listPayments>> = {
    complete: false,
    items: [],
  };
  for (let turn = 0; turn < 12 && !result.complete; turn++) {
    const abort = new AbortController();
    const work = f.transport.listPayments({
      ...window,
      signal: abort.signal,
    } as never);
    await vi.advanceTimersByTimeAsync(15000);
    abort.abort();
    await vi.advanceTimersByTimeAsync(100000);
    result = await work;
  }
  expect(result.complete).toBe(true);
  expect(result.items).toHaveLength(10);
  expect(f.pages.filter((page) => page === 0)).toHaveLength(1);
  expect(f.active()).toBe(0);
});
it("pre-aborted scans start no provider reads", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  const work = f.transport.listPayments({
    ...window,
    signal: abort.signal,
  } as never);
  expect(f.pages).toEqual([]);
  expect(await work).toEqual({ complete: false, items: [] });
});
it("shared scan turns never duplicate an in-flight cursor request", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    abort = new AbortController();
  const first = f.transport.listPayments({ ...window, signal: abort.signal });
  const second = f.transport.listPayments({ ...window, signal: abort.signal });
  await vi.advanceTimersByTimeAsync(15000);
  abort.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(await first).toEqual({ complete: false, items: [] });
  expect(await second).toEqual({ complete: false, items: [] });
  expect(f.pages).toEqual([0, 1]);
  expect(f.active()).toBe(0);
});
it("LIST abort destroys the real IPC socket and settles before shutdown", async () => {
  const address = `\0public-budget-${randomUUID()}`;
  let socket: Socket | undefined, connected!: () => void, closed!: () => void;
  const connection = new Promise<void>((resolve) => {
      connected = resolve;
    }),
    closure = new Promise<void>((resolve) => {
      closed = resolve;
    });
  const server = createServer((client) => {
    socket = client;
    client.once("close", closed);
    connected();
  });
  await new Promise<void>((resolve, reject) =>
    server.once("error", reject).listen(address, resolve),
  );
  try {
    const ipc = new ExperimentalGatewayIpc({
      address,
      key: Buffer.alloc(32, 1),
      authKey: Buffer.alloc(32, 2),
      timeoutMs: 10000,
    });
    const abort = new AbortController();
    const work = ipc.listPublicPage(
      "payments",
      { ...window, limit: 100 },
      abort.signal,
    );
    const outcome = work.catch((error) => error);
    await connection;
    abort.abort();
    expect(await outcome).toBeInstanceOf(Error);
    await closure;
  } finally {
    socket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 2000);
