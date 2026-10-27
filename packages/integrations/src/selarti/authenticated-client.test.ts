import { afterEach, describe, expect, it, vi } from "vitest";
import * as integrations from "../index.js";
import { TransportFailure } from "../http/transport-failure.js";
import type { SelartiRestFetch } from "./rest-client.js";

const config = {
  apiKey: "synthetic-key",
  companyId: "company",
  taskId: "task",
  aiId: "ai",
};
const auth = {
  status: "success",
  response: {
    user: { active_company: "company" },
    token: "synthetic-token",
    user_id: "user",
    expires: 123,
  },
};
const task = { _id: "task", company: "company", AI: "ai" };
const ai = { _id: "ai", company: "company" };
const thread = {
  _id: "thread",
  task: "task",
  company: "company",
  chat_id: "chat",
};
const message = {
  _id: "message",
  thread: "thread",
  task: "task",
  company: "company",
  text: "Answer",
  message_type: "bot",
  message_status: "pending",
};
const envelope = (response: unknown) => ({ status: "success", response });
const fixtures = () => [
  auth,
  envelope({ task: [task] }),
  envelope({ ai: [ai] }),
];
const query = { threadId: "thread", limit: 10, offset: 0 };
const unavailable = { kind: "unavailable", code: "acquisition_failed" };

function network(values: unknown[] = fixtures()) {
  let acquisition = 0;
  return vi.fn<SelartiRestFetch>(async (url) => {
    const path = new URL(url).pathname.split("/").at(-1);
    if (path === "send_message_external")
      return Response.json(envelope({ thread }));
    if (path === "get_message")
      return Response.json(envelope({ message: [message] }));
    const value = values[acquisition++];
    return value instanceof Response ? value : Response.json(value);
  });
}

async function acquire(fetcher: SelartiRestFetch) {
  const result = await integrations.createAuthenticatedSelartiClient({
    ...config,
    fetch: fetcher,
  });
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error("expected_ready");
  return result.client;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("authenticated ownership-bound Selarti client", () => {
  it("authenticates, verifies ownership, and uses the real REST send/read contract", async () => {
    const fetcher = network();
    const client = await acquire(fetcher);
    expect(
      await client.sendExternal({ chatId: "chat", text: "Hello" }),
    ).toEqual({
      kind: "accepted",
      threadId: "thread",
    });
    expect(await client.getMessages(query)).toEqual({
      kind: "page",
      messages: [
        {
          id: "message",
          threadId: "thread",
          taskId: "task",
          companyId: "company",
          text: "Answer",
          messageType: "bot",
          messageStatus: "pending",
        },
      ],
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://selarti.com/api/1.1/wf/auth",
      "https://selarti.com/api/1.1/wf/get_task?company_id=company&task_id=task",
      "https://selarti.com/api/1.1/wf/get_ai?company_id=company&ai_id=ai",
      "https://selarti.com/api/1.1/wf/send_message_external",
      "https://selarti.com/api/1.1/wf/get_message?thread_id=thread&limit=10&offset=0",
    ]);
    const login = fetcher.mock.calls[0]![1];
    expect(login).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(login.body as string)).toEqual({ key: "synthetic-key" });
    expect(new Headers(login.headers).get("Authorization")).toBeNull();
    for (const [, init] of fetcher.mock.calls.slice(1)) {
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer synthetic-token",
      );
    }
    expect(fetcher.mock.calls[1]![1].method).toBe("GET");
    expect(fetcher.mock.calls[2]![1].method).toBe("GET");
    expect(JSON.parse(fetcher.mock.calls[3]![1].body as string)).toEqual({
      task_id: "task",
      chat_id: "chat",
      message: "Hello",
      message_type: "user",
    });
    expect(Object.keys(client).sort()).toEqual(["getMessages", "sendExternal"]);
    expect(JSON.stringify(client)).not.toContain("synthetic-token");
    expect(Object.getOwnPropertySymbols(client)).toEqual([]);
  });

  it("captures all validated options before the first await and ignores foreign operation extras", async () => {
    const fetcher = network();
    const options = { ...config, fetch: fetcher };
    const pending = integrations.createAuthenticatedSelartiClient(options);
    options.apiKey = "foreign-key";
    options.companyId = options.taskId = options.aiId = "foreign";
    options.fetch = vi.fn(async () => {
      throw new Error("wrong_fetch");
    });
    const result = await pending;
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error("expected_ready");
    const extra = { taskId: "foreign", companyId: "foreign" };
    expect(
      await result.client.sendExternal({
        ...extra,
        chatId: "chat",
        text: "Hello",
      }),
    ).toEqual({ kind: "accepted", threadId: "thread" });
    expect(
      await result.client.getMessages({ ...query, ...extra }),
    ).toMatchObject({ kind: "page" });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
      key: "synthetic-key",
    });
    expect(fetcher.mock.calls[1]![0]).toContain(
      "company_id=company&task_id=task",
    );
    expect(fetcher.mock.calls[2]![0]).toContain("company_id=company&ai_id=ai");
    expect(JSON.parse(fetcher.mock.calls[3]![1].body as string).task_id).toBe(
      "task",
    );
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it("cannot turn a mismatched original binding into a ready client by mutating options", async () => {
    const options = { ...config, aiId: "wrong-ai", fetch: network() };
    const pending = integrations.createAuthenticatedSelartiClient(options);
    options.aiId = "ai";
    expect(await pending).toEqual({
      kind: "unavailable",
      code: "binding_unverified",
    });
    expect(options.fetch).toHaveBeenCalledTimes(2);
  });

  it("gets a fresh token on each acquisition and never interprets expires", async () => {
    let logins = 0;
    const base = network();
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth")) {
        logins += 1;
        return Response.json({
          ...auth,
          response: {
            ...auth.response,
            token: `token-${logins}`,
            expires: { opaque: true },
          },
        });
      }
      if (url.includes("get_task"))
        return Response.json(envelope({ task: [task] }));
      if (url.includes("get_ai")) return Response.json(envelope({ ai: [ai] }));
      return base(url, init);
    });
    const first = await acquire(fetcher);
    const second = await acquire(fetcher);
    await first.sendExternal({ chatId: "chat", text: "Hello" });
    await second.sendExternal({ chatId: "chat", text: "Hello" });
    expect(logins).toBe(2);
    expect(
      new Headers(fetcher.mock.calls[6]![1].headers).get("Authorization"),
    ).toBe("Bearer token-1");
    expect(
      new Headers(fetcher.mock.calls[7]![1].headers).get("Authorization"),
    ).toBe("Bearer token-2");
  });

  it.each([
    undefined,
    null,
    1,
    "",
    "   ",
    "\u00a0",
    "x\n",
    "x\u0085",
    "x".repeat(257),
    "\ud800",
  ])("rejects invalid IDs without network: %j", async (value) => {
    const fetcher = network();
    for (const key of ["companyId", "taskId", "aiId"] as const) {
      expect(
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          [key]: value,
          fetch: fetcher,
        } as unknown as integrations.AuthenticatedSelartiClientOptions),
      ).toEqual({ kind: "unavailable", code: "invalid_input" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    1,
    "",
    " ",
    "a b",
    "a\n",
    "a\u0085",
    "a\u00a0",
    "x".repeat(4097),
  ])("rejects invalid API keys without network: %j", async (apiKey) => {
    const fetcher = network();
    expect(
      await integrations.createAuthenticatedSelartiClient({
        ...config,
        apiKey,
        fetch: fetcher,
      } as unknown as integrations.AuthenticatedSelartiClientOptions),
    ).toEqual({ kind: "unavailable", code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([null, undefined, {}, { ...config, fetch: null }])(
    "rejects malformed factory options safely",
    async (value) => {
      const fetcher = vi.spyOn(globalThis, "fetch");
      expect(
        await integrations.createAuthenticatedSelartiClient(
          value as unknown as integrations.AuthenticatedSelartiClientOptions,
        ),
      ).toEqual({ kind: "unavailable", code: "invalid_input" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(["x", "x".repeat(256), " e\u0301😀 & "])(
    "preserves valid ID boundaries and URL encoding",
    async (value) => {
      const fetcher = network([
        {
          ...auth,
          response: { ...auth.response, user: { active_company: value } },
        },
        envelope({ task: [{ _id: value, company: value, AI: value }] }),
        envelope({ ai: [{ _id: value, company: value }] }),
      ]);
      expect(
        (
          await integrations.createAuthenticatedSelartiClient({
            apiKey: "x".repeat(4096),
            companyId: value,
            taskId: value,
            aiId: value,
            fetch: fetcher,
          })
        ).kind,
      ).toBe("ready");
      const url = new URL(fetcher.mock.calls[1]![0]);
      expect(url.searchParams.get("company_id")).toBe(value);
      expect(url.searchParams.get("task_id")).toBe(value);
      expect(new URL(fetcher.mock.calls[2]![0]).searchParams.get("ai_id")).toBe(
        value,
      );
    },
  );

  it("uses the platform fetch when no boundary is supplied", async () => {
    const fetcher = network();
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(
        (await integrations.createAuthenticatedSelartiClient(config)).kind,
      ).toBe("ready");
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  const badAuth = [
    {},
    { status: "error", response: auth.response },
    { ...auth, response: {} },
    ...[undefined, null, "", " ", "x y", "x\n", "токен"].map((token) => ({
      ...auth,
      response: { ...auth.response, token },
    })),
    ...[undefined, null, "", " ", 12].map((active_company) => ({
      ...auth,
      response: { ...auth.response, user: { active_company } },
    })),
  ];
  it.each(badAuth)(
    "rejects invalid authentication without ownership or message requests %#",
    async (value) => {
      const fetcher = network([value]);
      expect(
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        }),
      ).toEqual({ kind: "unavailable", code: "authentication_failed" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a foreign active company before ownership requests", async () => {
    const fetcher = network([
      {
        ...auth,
        response: { ...auth.response, user: { active_company: "foreign" } },
      },
    ]);
    expect(
      await integrations.createAuthenticatedSelartiClient({
        ...config,
        fetch: fetcher,
      }),
    ).toEqual({ kind: "unavailable", code: "binding_unverified" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [],
    [task, task],
    [{ ...task, _id: "wrong" }],
    [{ ...task, company: "foreign" }],
    [{ ...task, AI: "wrong" }],
    [{ _id: "task", company: "company", ai: "ai" }],
    [{ _id: "task", AI: "ai" }],
    [task, { ...task, _id: "other" }],
    null,
    {},
  ])("rejects missing, duplicate or foreign task bindings %#", async (rows) => {
    const fetcher = network([auth, envelope({ task: rows })]);
    expect(
      await integrations.createAuthenticatedSelartiClient({
        ...config,
        fetch: fetcher,
      }),
    ).toEqual({ kind: "unavailable", code: "binding_unverified" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [],
    [ai, ai],
    [{ ...ai, _id: "wrong" }],
    [{ ...ai, company: "foreign" }],
    [{ _id: "ai" }],
    [ai, { ...ai, _id: "other" }],
    null,
    {},
  ])("rejects missing, duplicate or foreign AI bindings %#", async (rows) => {
    const fetcher = network([
      auth,
      envelope({ task: [task] }),
      envelope({ ai: rows }),
    ]);
    expect(
      await integrations.createAuthenticatedSelartiClient({
        ...config,
        fetch: fetcher,
      }),
    ).toEqual({ kind: "unavailable", code: "binding_unverified" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([1, 2])(
    "requires success envelopes for ownership stage %s",
    async (stage) => {
      const values = fixtures();
      values[stage] = { status: "error", response: { task: [task], ai: [ai] } };
      const fetcher = network(values);
      expect(
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        }),
      ).toEqual({ kind: "unavailable", code: "binding_unverified" });
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
    },
  );

  it.each([0, 1, 2])(
    "bounds transport failures at acquisition stage %s and leaks no diagnostics",
    async (stage) => {
      const base = network();
      let calls = 0;
      const fetcher = vi.fn(async (url: string, init: RequestInit) => {
        if (calls++ === stage)
          throw new Error(
            "synthetic-key synthetic-token company task ai private-body",
          );
        return base(url, init);
      });
      const logs = ["log", "warn", "error", "info", "debug"].map((method) =>
        vi.spyOn(console, method as "log").mockImplementation(() => {}),
      );
      expect(
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        }),
      ).toEqual(unavailable);
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    },
  );

  it.each([0, 1, 2])(
    "rejects bounded response failures at stage %s and cancels bodies",
    async (stage) => {
      for (const failure of [
        "http",
        "redirect",
        "declared",
        "actual",
        "utf8",
        "json",
        "empty",
        "stream",
      ] as const) {
        const cancel = vi.fn();
        const bytes =
          failure === "actual"
            ? new Uint8Array(65537)
            : failure === "utf8"
              ? new Uint8Array([0xff])
              : new TextEncoder().encode("{");
        const bad =
          failure === "empty"
            ? new Response(null)
            : new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    if (failure === "stream")
                      controller.error(new Error("private-body"));
                    else controller.enqueue(bytes);
                  },
                  cancel,
                }),
                {
                  status: failure === "http" ? 503 : 200,
                  headers:
                    failure === "declared" ? { "content-length": "65537" } : {},
                },
              );
        if (failure === "redirect")
          Object.defineProperty(bad, "redirected", { value: true });
        // Close finite decoding failures, but leave resource failures open so cancellation is observable.
        let delivered = 0;
        const base = network();
        const fetcher = vi.fn(async (url: string, init: RequestInit) => {
          if (delivered++ !== stage) return base(url, init);
          if (["utf8", "json"].includes(failure)) return new Response(bytes);
          return bad;
        });
        expect(
          await integrations.createAuthenticatedSelartiClient({
            ...config,
            fetch: fetcher,
          }),
        ).toEqual(unavailable);
        expect(fetcher).toHaveBeenCalledTimes(stage + 1);
        if (["http", "redirect", "declared", "actual"].includes(failure))
          expect(cancel).toHaveBeenCalledTimes(1);
      }
    },
  );

  it.each(["-1", "NaN", "65537"])(
    "rejects invalid declared byte length %s",
    async (length) => {
      const fetcher = network([
        new Response(JSON.stringify(auth), {
          headers: { "content-length": length },
        }),
      ]);
      expect(
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        }),
      ).toEqual(unavailable);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts exactly 64 KiB per response including streamed multibyte text", async () => {
    const values = fixtures();
    const fetcher = network(
      values.map((value) => {
        const base = JSON.stringify({ ...value, metadata: "😀" });
        const body = JSON.stringify({
          ...value,
          metadata: "😀" + "x".repeat(65536 - Buffer.byteLength(base)),
        });
        const bytes = new TextEncoder().encode(body);
        expect(bytes.byteLength).toBe(65536);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 127)
                controller.enqueue(bytes.subarray(i, i + 127));
              controller.close();
            },
          }),
          { headers: { "content-length": "65536" } },
        );
      }),
    );
    expect(
      (
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        })
      ).kind,
    ).toBe("ready");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1, 2])(
    "cancels cumulatively oversized small chunks before any later request at stage %s",
    async (stage) => {
      const values = fixtures();
      const value = { ...values[stage], metadata: "" };
      const body = JSON.stringify({
        ...value,
        metadata: "x".repeat(
          70 * 1024 - Buffer.byteLength(JSON.stringify(value)),
        ),
      });
      expect(JSON.parse(body)).toMatchObject(values[stage]!);
      const bytes = new TextEncoder().encode(body);
      expect(bytes.byteLength).toBe(71680);
      let consumed = 0;
      let pulls = 0;
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              if (consumed === bytes.byteLength) {
                controller.close();
                return;
              }
              const chunk = bytes.subarray(consumed, consumed + 4096);
              expect(chunk.byteLength).toBeLessThanOrEqual(4096);
              consumed += chunk.byteLength;
              controller.enqueue(chunk);
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      );
      expect(response.headers.get("content-length")).toBeNull();
      let calls = 0;
      const fetcher = vi.fn<SelartiRestFetch>(async () => {
        const current = calls++;
        return current === stage ? response : Response.json(values[current]);
      });
      expect(
        await integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        }),
      ).toEqual(unavailable);
      expect(consumed).toBe(69632);
      expect(pulls).toBe(17);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
    },
  );

  it.each([0, 1, 2])(
    "cancels stalled headers or bodies within the acquisition deadline at stage %s",
    async (stage) => {
      for (const mode of ["headers", "body"] as const) {
        vi.useFakeTimers();
        const cancel = vi.fn();
        let signal: AbortSignal | null | undefined;
        let calls = 0;
        const base = network();
        const fetcher = vi.fn(async (url: string, init: RequestInit) => {
          if (calls++ !== stage) return base(url, init);
          signal = init.signal;
          return mode === "headers"
            ? new Promise<Response>(() => {})
            : new Response(new ReadableStream({ cancel }));
        });
        const pending = integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        });
        await vi.advanceTimersByTimeAsync(14999);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toEqual(unavailable);
        expect(signal?.aborted).toBe(true);
        if (mode === "body") expect(cancel).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledTimes(stage + 1);
        vi.useRealTimers();
      }
    },
  );

  it("shares one 15 second deadline across auth and both ownership requests", async () => {
    vi.useFakeTimers();
    const base = network();
    const fetcher = vi.fn(
      (url: string, init: RequestInit) =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            void base(url, init).then(resolve);
          }, 6000);
        }),
    );
    const pending = integrations.createAuthenticatedSelartiClient({
      ...config,
      fetch: fetcher,
    });
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]![1].signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1, 2])(
    "cancels a late body when acquisition fetch ignores abort at stage %s",
    async (stage) => {
      vi.useFakeTimers();
      let deliver!: (response: Response) => void;
      let calls = 0;
      const cancel = vi.fn();
      const base = network();
      const fetcher = vi.fn((url: string, init: RequestInit) =>
        calls++ === stage
          ? new Promise<Response>((resolve) => {
              deliver = resolve;
            })
          : base(url, init),
      );
      const pending = integrations.createAuthenticatedSelartiClient({
        ...config,
        fetch: fetcher,
      });
      await vi.advanceTimersByTimeAsync(15000);
      expect(await pending).toEqual(unavailable);
      deliver(new Response(new ReadableStream({ cancel })));
      await vi.advanceTimersByTimeAsync(0);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(stage + 1);
    },
  );

  const cleanupCases = [0, 1, 2].flatMap((stage) =>
    (["rejects", "pending"] as const).flatMap((cleanup) =>
      (["response_error", "body_timeout", "late_body"] as const).map(
        (flow) => ({ stage, cleanup, flow }),
      ),
    ),
  );
  it.each(cleanupCases)(
    "keeps $cleanup cancellation bounded without unhandled rejection at stage $stage ($flow)",
    async ({ stage, cleanup, flow }) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const cancel = vi.fn(() =>
          cleanup === "rejects"
            ? Promise.reject(new Error("synthetic_cancel_failure"))
            : new Promise<void>(() => {}),
        );
        const response = new Response(
          new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 }),
          {
            status: flow === "response_error" ? 503 : 200,
          },
        );
        let deliver!: (response: Response) => void;
        let calls = 0;
        const values = fixtures();
        const fetcher = vi.fn<SelartiRestFetch>(async () => {
          const current = calls++;
          if (current !== stage) return Response.json(values[current]);
          return flow === "late_body"
            ? new Promise<Response>((resolve) => {
                deliver = resolve;
              })
            : response;
        });
        const pending = integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        });
        const settled = vi.fn();
        void pending.then(settled);
        await vi.advanceTimersByTimeAsync(
          flow === "response_error" ? 0 : 15000,
        );
        // Immediate failures must return without awaiting provider cleanup; a
        // timer-only fallback would hide an indefinitely pending cancel callback.
        expect(settled).toHaveBeenCalledExactlyOnceWith(unavailable);
        expect(await pending).toEqual(unavailable);
        if (flow === "late_body") {
          deliver(response);
          await vi.advanceTimersByTimeAsync(0);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(unhandled).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(stage + 1);
        expect(fetcher.mock.calls[stage]![1].signal?.aborted).toBe(true);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  it.each([0, 1, 2])(
    "handles fetch rejection after the outer timeout without later requests at stage %s",
    async (stage) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        let rejectLate!: (reason: Error) => void;
        let calls = 0;
        const values = fixtures();
        const fetcher = vi.fn<SelartiRestFetch>(async () => {
          const current = calls++;
          return current === stage
            ? new Promise<Response>((_resolve, reject) => {
                rejectLate = reject;
              })
            : Response.json(values[current]);
        });
        const pending = integrations.createAuthenticatedSelartiClient({
          ...config,
          fetch: fetcher,
        });
        await vi.advanceTimersByTimeAsync(15000);
        expect(await pending).toEqual(unavailable);
        rejectLate(new Error("synthetic_late_fetch_failure"));
        await vi.advanceTimersByTimeAsync(0);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(unhandled).toEqual([]);
        expect(fetcher).toHaveBeenCalledTimes(stage + 1);
        expect(fetcher.mock.calls[stage]![1].signal?.aborted).toBe(true);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    },
  );

  it("bounds endless empty chunks using monotonic time even when timers cannot run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let pulls = 0;
    const cancel = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                pulls += 1;
                now += 1000;
                if (pulls <= 16) controller.enqueue(new Uint8Array());
                else {
                  controller.enqueue(
                    new TextEncoder().encode(JSON.stringify(auth)),
                  );
                  controller.close();
                }
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
        ),
    );
    expect(
      await integrations.createAuthenticatedSelartiClient({
        ...config,
        fetch: fetcher,
      }),
    ).toEqual(unavailable);
    expect(pulls).toBe(15);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([401, 500])(
    "does not reauthenticate or resend an ambiguous HTTP %s send",
    async (status) => {
      const base = network();
      const fetcher = vi.fn(async (url: string, init: RequestInit) =>
        url.endsWith("send_message_external")
          ? Response.json(envelope({ thread }), { status })
          : base(url, init),
      );
      const client = await acquire(fetcher);
      expect(
        await client.sendExternal({ chatId: "chat", text: "Hello" }),
      ).toEqual({ kind: "unknown", code: "send_unconfirmed" });
      expect(fetcher).toHaveBeenCalledTimes(4);
    },
  );

  it("does not reauthenticate or resend a timed-out send", async () => {
    vi.useFakeTimers();
    const base = network();
    const fetcher = vi.fn((url: string, init: RequestInit) =>
      url.endsWith("send_message_external")
        ? new Promise<Response>(() => {})
        : base(url, init),
    );
    const client = await acquire(fetcher);
    const pending = client.sendExternal({ chatId: "chat", text: "Hello" });
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual({
      kind: "unknown",
      code: "send_unconfirmed",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each(["before_write", "after_write"] as const)(
    "preserves strict REST transport classification %s",
    async (phase) => {
      const base = network();
      const fetcher = vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("send_message_external"))
          throw new TransportFailure(phase);
        return base(url, init);
      });
      const client = await acquire(fetcher);
      expect(
        await client.sendExternal({ chatId: "chat", text: "Hello" }),
      ).toEqual(
        phase === "before_write"
          ? { kind: "not_applied", code: "before_write" }
          : { kind: "unknown", code: "send_unconfirmed" },
      );
      expect(fetcher).toHaveBeenCalledTimes(4);
    },
  );

  it("rejects foreign REST responses using the verified company and task", async () => {
    const base = network();
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("send_message_external"))
        return Response.json(
          envelope({ thread: { ...thread, company: "foreign" } }),
        );
      if (url.includes("get_message"))
        return Response.json(
          envelope({ message: [message, { ...message, task: "foreign" }] }),
        );
      return base(url, init);
    });
    const client = await acquire(fetcher);
    expect(
      await client.sendExternal({ chatId: "chat", text: "Hello" }),
    ).toEqual({ kind: "unknown", code: "send_unconfirmed" });
    expect(await client.getMessages(query)).toEqual({
      kind: "error",
      code: "read_failed",
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("preserves local send/read validation before network operations", async () => {
    const fetcher = network();
    const client = await acquire(fetcher);
    expect(await client.sendExternal({ chatId: "chat", text: "" })).toEqual({
      kind: "not_applied",
      code: "invalid_input",
    });
    expect(await client.getMessages({ ...query, limit: 101 })).toEqual({
      kind: "error",
      code: "invalid_input",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(["chatId", "text"] as const)(
    "returns a Promise-safe invalid send when %s getter throws before delegation",
    async (field) => {
      const fetcher = network();
      const client = await acquire(fetcher);
      const command = { chatId: "chat", text: "Hello" };
      Object.defineProperty(command, field, {
        get() {
          throw new Error("synthetic_private_input");
        },
      });
      const pending = client.sendExternal(command);
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).resolves.toEqual({
        kind: "not_applied",
        code: "invalid_input",
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["threadId", "limit", "offset"] as const)(
    "returns a Promise-safe invalid read when %s getter throws before delegation",
    async (field) => {
      const fetcher = network();
      const client = await acquire(fetcher);
      const input = { ...query };
      Object.defineProperty(input, field, {
        get() {
          throw new Error("synthetic_private_input");
        },
      });
      const pending = client.getMessages(input);
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).resolves.toEqual({
        kind: "error",
        code: "invalid_input",
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it("returns Promise-safe invalid send/read results for revoked proxies without delegation", async () => {
    const fetcher = network();
    const client = await acquire(fetcher);
    const send = Proxy.revocable({ chatId: "chat", text: "Hello" }, {});
    const read = Proxy.revocable({ ...query }, {});
    send.revoke();
    read.revoke();
    const pendingSend = client.sendExternal(send.proxy);
    const pendingRead = client.getMessages(read.proxy);
    expect(pendingSend).toBeInstanceOf(Promise);
    expect(pendingRead).toBeInstanceOf(Promise);
    await expect(pendingSend).resolves.toEqual({
      kind: "not_applied",
      code: "invalid_input",
    });
    await expect(pendingRead).resolves.toEqual({
      kind: "error",
      code: "invalid_input",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
