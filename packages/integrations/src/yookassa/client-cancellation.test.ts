import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  createYooKassaClient,
  YooKassaTerminalError,
  YooKassaUnknownOutcomeError,
  type CreateYooKassaPayment,
  type CreateYooKassaPaymentOptions,
  type YooKassaClientConfig,
  type YooKassaTransport,
} from "../index.js";

const MAX_BYTES = 256 * 1024;
const PRIVATE_DETAIL = "synthetic-private-cancellation-or-provider-detail";
const config: YooKassaClientConfig = {
  mode: "test",
  shopId: "test-shop",
  secretKey: "synthetic-unused-key",
};
const command = {
  amountMinor: 50_000n,
  idempotencyKey: "d5cab70e-c30f-4baf-9da0-e8f633c475f8",
  description: "Synthetic checkout",
  returnUrl: "https://example.invalid/return",
  metadata: { order_id: "synthetic-order" },
  receipt: {
    customer: { email: "fixture@example.invalid" },
    item: {
      description: "Synthetic checkout",
      vatCode: 1,
      paymentSubject: "service",
      paymentMode: "full_payment",
    },
  },
} satisfies CreateYooKassaPayment;
const payment = {
  id: "synthetic-payment",
  status: "pending",
  paid: false,
  amount: { value: "500.00", currency: "RUB" },
  test: true,
  created_at: "2026-10-14T10:00:00.000Z",
  metadata: { order_id: "synthetic-order" },
  confirmation: {
    type: "redirect",
    confirmation_url: "https://example.invalid/confirmation",
  },
  refundable: false,
  recipient: { account_id: "private-provider-field" },
};
const refund = {
  id: "synthetic-refund",
  payment_id: "synthetic-payment",
  status: "pending",
  amount: { value: "500.00", currency: "RUB" },
  created_at: "2026-10-14T10:00:00.000Z",
};
const paymentBytes = new TextEncoder().encode(JSON.stringify(payment));
const jsonResponse = (body: unknown = payment) =>
  new Response(JSON.stringify(body));
const outcome = (promise: Promise<unknown>): Promise<unknown> =>
  promise.catch((error: unknown) => error);

function expectUnknown(error: unknown): void {
  expect(error).toBeInstanceOf(YooKassaUnknownOutcomeError);
  expect(error).toMatchObject({
    name: "YooKassaUnknownOutcomeError",
    message: "yookassa_unknown_outcome",
    code: "yookassa_unknown_outcome",
  });
  expect(error).not.toHaveProperty("cause");
  expect(String(error)).not.toContain(PRIVATE_DETAIL);
  expect(JSON.stringify(error)).not.toContain(PRIVATE_DETAIL);
}

function expectTerminal(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(YooKassaTerminalError);
  expect(error).toMatchObject({ code, message: code });
  expect(error).not.toHaveProperty("cause");
  expect(String(error)).not.toContain(PRIVATE_DETAIL);
}

// HWM zero prevents eager pulls: the counter measures consumption by the client.
// finish() lets the unfixed client settle during RED without test-timeout failures.
function waitingBody(
  init: ResponseInit = {},
  cancellation: "resolve" | "reject" | "pending" = "resolve",
) {
  const reading = Promise.withResolvers<void>();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let pulls = 0;
  let cancellations = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull() {
        pulls += 1;
        reading.resolve();
      },
      cancel() {
        cancellations += 1;
        if (cancellation === "reject")
          return Promise.reject(new Error(PRIVATE_DETAIL));
        if (cancellation === "pending") return new Promise<void>(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, init),
    reading: reading.promise,
    get pulls() {
      return pulls;
    },
    get cancellations() {
      return cancellations;
    },
    finish() {
      if (cancellations === 0) {
        controller.enqueue(paymentBytes);
        controller.close();
      }
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("YooKassa request cancellation", () => {
  it("keeps a pre-cancelled receipt entirely out of transport", async () => {
    const caller = new AbortController();
    caller.abort(new Error(PRIVATE_DETAIL));
    const transport = vi.fn<YooKassaTransport>(async () => jsonResponse());
    const client = createYooKassaClient(config, transport);

    expectUnknown(
      await outcome(client.createPayment(command, { signal: caller.signal })),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("aborts an in-flight POST through its transport signal without resending", async () => {
    const caller = new AbortController();
    const response = Promise.withResolvers<Response>();
    const transport = vi.fn<YooKassaTransport>(async (_url, init) => {
      init.signal!.addEventListener(
        "abort",
        () => response.reject(init.signal!.reason),
        { once: true },
      );
      return response.promise;
    });
    const result = outcome(
      createYooKassaClient(config, transport).createPayment(command, {
        signal: caller.signal,
      }),
    );

    caller.abort(new Error(PRIVATE_DETAIL));
    response.resolve(jsonResponse());

    expectUnknown(await result);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
  });

  it.each([200, 401])(
    "rejects cancellation at the headers boundary before consuming HTTP %s",
    async (status) => {
      const caller = new AbortController();
      const body = waitingBody({ status }, "pending");
      body.finish();
      const transport = vi.fn<YooKassaTransport>(async () => {
        caller.abort(PRIVATE_DETAIL);
        return body.response;
      });

      expectUnknown(
        await outcome(
          createYooKassaClient(config, transport).createPayment(command, {
            signal: caller.signal,
          }),
        ),
      );
      expect(body.response.bodyUsed).toBe(true);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it.each(["resolve", "reject", "pending"] as const)(
    "cancels a pending body read even when its cancellation hook will %s",
    async (cancellation) => {
      const caller = new AbortController();
      const body = waitingBody({}, cancellation);
      const transport = vi.fn<YooKassaTransport>(async () => body.response);
      const result = outcome(
        createYooKassaClient(config, transport).createPayment(command, {
          signal: caller.signal,
        }),
      );
      await body.reading;

      caller.abort({ privateReason: PRIVATE_DETAIL });
      body.finish();

      expectUnknown(await result);
      expect(body.cancellations).toBe(1);
      expect(body.pulls).toBe(1);
      expect(body.response.body?.locked).toBe(false);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it.each(["last chunk", "end of stream"])(
    "does not return a payment when cancellation coincides with the %s",
    async (boundary) => {
      const caller = new AbortController();
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (pulls === 1) controller.enqueue(paymentBytes);
            if (boundary === "last chunk" || pulls === 2) {
              controller.close();
              caller.abort(PRIVATE_DETAIL);
            }
          },
        },
        { highWaterMark: 0 },
      );
      const client = createYooKassaClient(
        config,
        async () => new Response(body),
      );

      expectUnknown(
        await outcome(client.createPayment(command, { signal: caller.signal })),
      );
      expect(body.locked).toBe(false);
    },
  );

  it.each([
    ["transport", true],
    ["body", true],
    ["transport", false],
    ["body", false],
  ] as const)(
    "retains the fifteen-second ceiling while awaiting %s (caller signal: %s)",
    async (boundary, withCaller) => {
      const ceiling = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(ceiling.signal);
      const caller = new AbortController();
      const body = waitingBody({}, "pending");
      const response = Promise.withResolvers<Response>();
      const transport = vi.fn<YooKassaTransport>(async (_url, init) => {
        if (boundary === "body") return body.response;
        init.signal!.addEventListener(
          "abort",
          () => response.reject(new Error(PRIVATE_DETAIL)),
          { once: true },
        );
        return response.promise;
      });
      const result = outcome(
        createYooKassaClient(config, transport).createPayment(
          command,
          withCaller ? { signal: caller.signal } : undefined,
        ),
      );
      if (boundary === "body") await body.reading;

      ceiling.abort(new Error(PRIVATE_DETAIL));
      body.finish();
      response.resolve(jsonResponse());

      expectUnknown(await result);
      expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
      expect(caller.signal.aborted).toBe(false);
      expect(transport.mock.calls[0]![1].signal?.aborted).toBe(true);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it("keeps cancellation local to one of two simultaneous payments", async () => {
    const caller = new AbortController();
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    let calls = 0;
    const transport = vi.fn<YooKassaTransport>(async (_url, init) => {
      const response = calls++ === 0 ? first : second;
      init.signal!.addEventListener(
        "abort",
        () => response.reject(new Error(PRIVATE_DETAIL)),
        { once: true },
      );
      return response.promise;
    });
    const client = createYooKassaClient(config, transport);
    const cancelled = outcome(
      client.createPayment(command, { signal: caller.signal }),
    );
    const successful = client.createPayment({
      ...command,
      idempotencyKey: "a5cab70e-c30f-4baf-9da0-e8f633c475f8",
    });

    caller.abort(PRIVATE_DETAIL);
    first.resolve(jsonResponse());
    second.resolve(jsonResponse());

    expectUnknown(await cancelled);
    expect(await successful).toMatchObject({ id: "synthetic-payment" });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]![1].signal).not.toBe(
      transport.mock.calls[1]![1].signal,
    );
    expect(transport.mock.calls[1]![1].signal?.aborted).toBe(false);
  });

  it.each(["before data", "after data", "forged terminal"])(
    "sanitizes private body failures %s as unknown outcomes",
    async (boundary) => {
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (boundary === "after data" && pulls === 1) {
              controller.enqueue(paymentBytes.subarray(0, 10));
              return;
            }
            throw boundary === "forged terminal"
              ? new YooKassaTerminalError(PRIVATE_DETAIL)
              : new Error(PRIVATE_DETAIL);
          },
        },
        { highWaterMark: 0 },
      );
      const transport = vi.fn<YooKassaTransport>(
        async () => new Response(body),
      );

      expectUnknown(
        await outcome(
          createYooKassaClient(config, transport).createPayment(command),
        ),
      );
      expect(body.locked).toBe(false);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it("sanitizes private transport failures without retry", async () => {
    const transport = vi.fn<YooKassaTransport>(async () => {
      throw new Error(PRIVATE_DETAIL);
    });
    expectUnknown(
      await outcome(
        createYooKassaClient(config, transport).createPayment(command),
      ),
    );
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each(["reject", "pending"] as const)(
    "cancels a declared oversize body without reading or waiting for its %s hook",
    async (cancellation) => {
      const body = waitingBody(
        { headers: { "content-length": String(MAX_BYTES + 1) } },
        cancellation,
      );
      const client = createYooKassaClient(config, async () => body.response);

      expectTerminal(
        await outcome(client.createPayment(command)),
        "yookassa_response_invalid",
      );
      expect(body.pulls).toBe(0);
      expect(body.cancellations).toBe(1);
      expect(body.response.body?.locked).toBe(false);
    },
  );

  it.each([undefined, "1"])(
    "counts streamed UTF-8 bytes and stops at the first oversized chunk (length %s)",
    async (declared) => {
      const text = JSON.stringify({
        ...payment,
        ignored: "я".repeat(MAX_BYTES / 2),
      });
      const bytes = new TextEncoder().encode(text);
      expect(text.length).toBeLessThan(MAX_BYTES);
      expect(bytes.byteLength).toBeGreaterThan(MAX_BYTES);
      const chunks = [
        bytes.subarray(0, MAX_BYTES),
        bytes.subarray(MAX_BYTES, MAX_BYTES + 1),
        bytes.subarray(MAX_BYTES + 1),
      ];
      let pulls = 0;
      let cancellations = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            const chunk = chunks[pulls++];
            if (chunk) controller.enqueue(chunk);
            else controller.close();
          },
          cancel() {
            cancellations += 1;
            return new Promise<void>(() => {});
          },
        },
        { highWaterMark: 0 },
      );
      const client = createYooKassaClient(
        config,
        async () =>
          new Response(body, {
            ...(declared === undefined
              ? {}
              : { headers: { "content-length": declared } }),
          }),
      );

      expectTerminal(
        await outcome(client.createPayment(command)),
        "yookassa_response_invalid",
      );
      expect(pulls).toBe(2);
      expect(cancellations).toBe(1);
      expect(body.locked).toBe(false);
    },
  );

  it("accepts exactly 256KiB and decodes a multibyte character split across chunks", async () => {
    const text = JSON.stringify({ ...payment, metadata: { note: "ёж" } });
    const bytes = Buffer.from(
      text + " ".repeat(MAX_BYTES - Buffer.byteLength(text)),
    );
    const split = bytes.indexOf(Buffer.from("ё")) + 1;
    const chunks = [bytes.subarray(0, split), bytes.subarray(split)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const client = createYooKassaClient(
      config,
      async () =>
        new Response(body, {
          headers: { "content-length": String(MAX_BYTES) },
        }),
    );

    expect(await client.createPayment(command)).toMatchObject({
      id: "synthetic-payment",
      metadata: { note: "ёж" },
    });
    expect(body.locked).toBe(false);
  });

  it("preserves response.text UTF-8 BOM handling", async () => {
    const client = createYooKassaClient(
      config,
      async () => new Response("\uFEFF" + JSON.stringify(payment)),
    );
    expect(await client.createPayment(command)).toMatchObject({
      id: "synthetic-payment",
    });
  });

  it("accepts byte chunks from another JavaScript realm", async () => {
    const bytes = runInNewContext("Uint8Array.from(input)", {
      input: paymentBytes,
    }) as Uint8Array;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const client = createYooKassaClient(config, async () => new Response(body));
    expect(await client.createPayment(command)).toMatchObject({
      id: "synthetic-payment",
    });
  });

  it("owns consumed bytes when the transport reuses its backing buffer", async () => {
    const reused = new Uint8Array(paymentBytes);
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(reused);
          else {
            reused.fill(32);
            controller.close();
          }
        },
      },
      { highWaterMark: 0 },
    );
    const client = createYooKassaClient(config, async () => new Response(body));
    expect(await client.createPayment(command)).toMatchObject({
      id: "synthetic-payment",
    });
  });

  it("lets cancellation run during a flood of immediately readable empty chunks", async () => {
    const caller = new AbortController();
    let pulls = 0;
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          // Finite fallback avoids hanging the baseline test process itself.
          if (++pulls < 5000) controller.enqueue(new Uint8Array(0));
          else {
            controller.enqueue(paymentBytes);
            controller.close();
          }
        },
        cancel() {
          cancellations += 1;
        },
      },
      { highWaterMark: 0 },
    );
    const turn = setImmediate(() => caller.abort(PRIVATE_DETAIL));
    try {
      const client = createYooKassaClient(
        config,
        async () => new Response(body),
      );
      expectUnknown(
        await outcome(client.createPayment(command, { signal: caller.signal })),
      );
      expect(pulls).toBeLessThan(5000);
      expect(cancellations).toBe(1);
      expect(body.locked).toBe(false);
    } finally {
      clearImmediate(turn);
    }
  });

  it("sanitizes an already locked body without releasing another reader", async () => {
    const response = jsonResponse();
    const owner = response.body!.getReader();
    try {
      const client = createYooKassaClient(config, async () => response);
      expectUnknown(await outcome(client.createPayment(command)));
      expect(response.body!.locked).toBe(true);
    } finally {
      await owner.cancel();
      owner.releaseLock();
    }
  });

  it("rejects non-byte chunks with a sanitized unknown outcome", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(PRIVATE_DETAIL as unknown as Uint8Array);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const client = createYooKassaClient(config, async () => new Response(body));
    expectUnknown(await outcome(client.createPayment(command)));
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it.each([null, "", "not-json", '{"unexpected":true}'])(
    "retains response-invalid errors for empty, malformed or invalid JSON: %s",
    async (body) => {
      const client = createYooKassaClient(
        config,
        async () => new Response(body),
      );
      expectTerminal(
        await outcome(client.createPayment(command)),
        "yookassa_response_invalid",
      );
    },
  );

  it.each([401, 403, 404, 429, 500, 503])(
    "preserves HTTP %s classification while cancelling its unread body",
    async (status) => {
      const body = waitingBody({ status }, "reject");
      const transport = vi.fn<YooKassaTransport>(async () => body.response);
      const result = await outcome(
        createYooKassaClient(config, transport).createPayment(command),
      );

      if (status === 429 || status >= 500) expectUnknown(result);
      else expectTerminal(result, `yookassa_http_${status}`);
      expect(body.pulls).toBe(0);
      expect(body.cancellations).toBe(1);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it.each(["omitted", "active"])(
    "preserves exact payment wire data, bindings and validated output with %s options",
    async (mode) => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const transport = vi.fn<YooKassaTransport>(async () => jsonResponse());
      const options: CreateYooKassaPaymentOptions | undefined =
        mode === "active"
          ? { signal: new AbortController().signal }
          : undefined;
      const result = await createYooKassaClient(
        config,
        transport,
      ).createPayment(command, options);

      expect(transport).toHaveBeenCalledOnce();
      const [url, init] = transport.mock.calls[0]!;
      expect(url).toBe("https://api.yookassa.ru/v3/payments");
      expect(init.method).toBe("POST");
      expect(Object.fromEntries(new Headers(init.headers))).toEqual({
        accept: "application/json",
        authorization: `Basic ${Buffer.from("test-shop:synthetic-unused-key").toString("base64")}`,
        "content-type": "application/json",
        "idempotence-key": "d5cab70e-c30f-4baf-9da0-e8f633c475f8",
      });
      expect(init.body).toBe(
        JSON.stringify({
          amount: { value: "500.00", currency: "RUB" },
          capture: true,
          confirmation: {
            type: "redirect",
            return_url: "https://example.invalid/return",
          },
          description: "Synthetic checkout",
          metadata: { order_id: "synthetic-order" },
          receipt: {
            customer: { email: "fixture@example.invalid" },
            items: [
              {
                description: "Synthetic checkout",
                quantity: "1.00",
                amount: { value: "500.00", currency: "RUB" },
                vat_code: 1,
                payment_subject: "service",
                payment_mode: "full_payment",
              },
            ],
          },
        }),
      );
      expect(result).toEqual({
        id: "synthetic-payment",
        status: "pending",
        paid: false,
        amount: { value: "500.00", currency: "RUB" },
        test: true,
        createdAt: "2026-10-14T10:00:00.000Z",
        metadata: { order_id: "synthetic-order" },
        confirmation: {
          type: "redirect",
          url: "https://example.invalid/confirmation",
        },
        refundable: false,
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
      expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
    },
  );

  it.each([
    [{ amountMinor: 0n }, "yookassa_amount_invalid"],
    [{ idempotencyKey: "invalid" }, "yookassa_idempotency_key_invalid"],
    [
      { receipt: { ...command.receipt, customer: {} } },
      "yookassa_receipt_contact_invalid",
    ],
  ] as const)(
    "preserves pre-transport validation for %s",
    async (change, code) => {
      const transport = vi.fn<YooKassaTransport>(async () => jsonResponse());
      const client = createYooKassaClient(config, transport);
      expectTerminal(
        await outcome(
          client.createPayment(
            { ...command, ...change },
            {
              signal: new AbortController().signal,
            },
          ),
        ),
        code,
      );
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ test: false }, "yookassa_mode_mismatch"],
    [
      { amount: { value: "1.00", currency: "RUB" } },
      "yookassa_amount_mismatch",
    ],
  ])(
    "preserves payment response binding errors for %s",
    async (change, code) => {
      const client = createYooKassaClient(config, async () =>
        jsonResponse({ ...payment, ...(change as object) }),
      );
      expectTerminal(
        await outcome(client.createPayment(command)),
        code as string,
      );
    },
  );

  it("preserves refund serialization and authoritative payment/refund GET contracts", async () => {
    const transport = vi.fn<YooKassaTransport>(async (url) =>
      jsonResponse(url.includes("/refunds") ? refund : payment),
    );
    const client = createYooKassaClient(config, transport);
    expect(await client.getPayment("synthetic-payment")).toMatchObject({
      id: "synthetic-payment",
    });
    expect(
      await client.createRefund({
        paymentId: "synthetic-payment",
        amountMinor: 50_000n,
        idempotencyKey: command.idempotencyKey,
        description: "Synthetic refund",
        receipt: command.receipt,
      }),
    ).toEqual({
      id: "synthetic-refund",
      paymentId: "synthetic-payment",
      status: "pending",
      amount: { value: "500.00", currency: "RUB" },
      createdAt: "2026-10-14T10:00:00.000Z",
    });
    expect(await client.getRefund("synthetic-refund")).toMatchObject({
      paymentId: "synthetic-payment",
    });
    expect(
      transport.mock.calls.map(([url, init]) => [url, init.method]),
    ).toEqual([
      ["https://api.yookassa.ru/v3/payments/synthetic-payment", "GET"],
      ["https://api.yookassa.ru/v3/refunds", "POST"],
      ["https://api.yookassa.ru/v3/refunds/synthetic-refund", "GET"],
    ]);
    const refundRequest = transport.mock.calls[1]![1];
    expect(JSON.parse(String(refundRequest.body))).toEqual({
      payment_id: "synthetic-payment",
      amount: { value: "500.00", currency: "RUB" },
      description: "Synthetic refund",
      receipt: {
        customer: { email: "fixture@example.invalid" },
        items: [
          {
            description: "Synthetic checkout",
            quantity: "1.00",
            amount: { value: "500.00", currency: "RUB" },
            vat_code: 1,
            payment_subject: "service",
            payment_mode: "full_payment",
          },
        ],
      },
    });
    expect(new Headers(refundRequest.headers).get("Idempotence-Key")).toBe(
      command.idempotencyKey,
    );
    expect(transport.mock.calls[0]![1].body).toBeUndefined();
    expect(transport.mock.calls[2]![1].body).toBeUndefined();
    await expect(client.getPayment("../refunds")).rejects.toThrow(
      "yookassa_provider_id_invalid",
    );
    await expect(client.getRefund("../payments")).rejects.toThrow(
      "yookassa_provider_id_invalid",
    );
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["payment GET", "deadline"],
    ["refund GET", "deadline"],
    ["refund POST", "deadline"],
    ["payment GET", "body error"],
    ["refund GET", "body error"],
    ["refund POST", "body error"],
    ["payment GET", "oversize"],
    ["refund GET", "oversize"],
    ["refund POST", "oversize"],
  ] as const)("bounds and sanitizes %s during %s", async (method, failure) => {
    const ceiling = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(ceiling.signal);
    const waiting = waitingBody(
      failure === "oversize"
        ? { headers: { "content-length": String(MAX_BYTES + 1) } }
        : {},
      "pending",
    );
    const response =
      failure === "body error"
        ? new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.error(new Error(PRIVATE_DETAIL));
              },
            }),
          )
        : waiting.response;
    const transport = vi.fn<YooKassaTransport>(async () => response);
    const client = createYooKassaClient(config, transport);
    const result = outcome(
      method === "payment GET"
        ? client.getPayment("synthetic-payment")
        : method === "refund GET"
          ? client.getRefund("synthetic-refund")
          : client.createRefund({
              paymentId: "synthetic-payment",
              amountMinor: 50_000n,
              idempotencyKey: command.idempotencyKey,
              description: "Synthetic refund",
              receipt: command.receipt,
            }),
    );
    if (failure === "deadline") {
      await waiting.reading;
      ceiling.abort(PRIVATE_DETAIL);
      waiting.finish();
    }
    if (failure === "oversize") {
      expectTerminal(await result, "yookassa_response_invalid");
      expect(waiting.pulls).toBe(0);
    } else expectUnknown(await result);
    expect(response.body?.locked).toBe(false);
    expect(transport).toHaveBeenCalledOnce();
  });
});
