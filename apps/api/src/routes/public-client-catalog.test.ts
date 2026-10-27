import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import type { FastifyInstance, InjectOptions } from "fastify";
import Fastify from "fastify";
import { publicClientCatalogRoutes } from "./public-client-catalog.js";
import { buildTestApp } from "../app.js";
import { createWindowedRateLimiter } from "../rate-limit.js";

const item = { displayName: "Эксперт", serviceCode: "career", language: "ru" };
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function build(
  rows: unknown = [item],
  publicCatalogLoadState = {
    limiter: createWindowedRateLimiter(),
    inFlight: 0,
  },
) {
  const listPublicServices = vi.fn<
    (input: { limit: number }) => Promise<unknown>
  >(async () => rows);
  const resolve = vi.fn(async () => ({ kind: "denied" as const }));
  const options = {
    publicCatalog: { listPublicServices },
    publicCatalogLoadState,
    clientPrincipal: { resolve },
  };
  const app = await buildTestApp(options);
  apps.push(app);
  return { app, listPublicServices, resolve };
}
function privacyHeaders(headers: Record<string, unknown>) {
  expect(headers["cache-control"]).toBe("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["set-cookie"]).toBeUndefined();
}

describe("anonymous public catalog", () => {
  it("uses the same default process load cap across independently registered apps", async () => {
    const pending = Promise.withResolvers<unknown>();
    const entered = Promise.withResolvers<void>();
    let reads = 0;
    const catalog = {
      listPublicServices: async () => {
        reads++;
        if (reads === 2) entered.resolve();
        return pending.promise;
      },
    };
    const first = Fastify();
    const second = Fastify();
    apps.push(first, second);
    await first.register(publicClientCatalogRoutes, { catalog });
    await second.register(publicClientCatalogRoutes, { catalog });
    const a = first
      .inject({ url: "/v1/public/catalog" })
      .then((response) => response);
    const b = second
      .inject({ url: "/v1/public/catalog" })
      .then((response) => response);
    await entered.promise;
    try {
      const blocked = await second.inject({ url: "/v1/public/catalog" });
      expect(blocked.statusCode).toBe(503);
      expect(reads).toBe(2);
    } finally {
      pending.resolve([]);
      await Promise.all([a, b]);
    }
  });
  it("explicitly projects three fields regardless of caller identity, without principal resolution", async () => {
    const { app, listPublicServices, resolve } = await build([
      {
        ...item,
        sourceKey: "secret",
        email: "secret",
        profile: { private: true },
        id: "secret",
        unknown: "secret",
      },
    ]);
    for (const headers of [
      {},
      { cookie: "session=private", authorization: "Bearer private" },
    ]) {
      const response = await app.inject({ url: "/v1/public/catalog", headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ items: [item] });
      privacyHeaders(response.headers);
    }
    expect(listPublicServices).toHaveBeenCalledTimes(2);
    expect(listPublicServices).toHaveBeenCalledWith({ limit: 20 });
    expect(resolve).not.toHaveBeenCalled();
  });
  it("supports HEAD without a body", async () => {
    const { app } = await build();
    const response = await app.inject({
      method: "HEAD",
      url: "/v1/public/catalog",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    privacyHeaders(response.headers);
  });
  it("reports genuine empty inventory as success", async () => {
    const { app } = await build([]);
    const response = await app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    privacyHeaders(response.headers);
  });
  it("reports missing dependency as unavailable", async () => {
    const app = await buildTestApp();
    apps.push(app);
    const response = await app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "catalog_unavailable" });
    privacyHeaders(response.headers);
  });
  it("sanitizes repository failures", async () => {
    const { app, listPublicServices } = await build();
    listPublicServices.mockRejectedValue(new Error("private database details"));
    const warn = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
    const response = await app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "catalog_unavailable" });
    privacyHeaders(response.headers);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { reason: "repository_failure" },
      "public_catalog_failure",
    );
  });
  it.each(
    [
      null,
      {},
      [null],
      [[]],
      ["row"],
      new Array(21).fill(item),
      [{ ...item, displayName: " " }],
      [{ ...item, displayName: "x".repeat(201) }],
      [{ ...item, serviceCode: 1 }],
      [{ ...item, serviceCode: "" }],
      [{ ...item, serviceCode: "x".repeat(65) }],
      [{ ...item, language: "x".repeat(33) }],
      [{ ...item, language: "\u0000ru" }],
      [{ ...item, displayName: "a\nb" }],
      [{ ...item, language: "ru\u007f" }],
      [{ ...item, serviceCode: "a\u0085b" }],
      [{ displayName: "Name", serviceCode: "career" }],
      ...[
        "\u202e",
        "\u202d",
        "\u202a",
        "\u202b",
        "\u202c",
        "\u2066",
        "\u2067",
        "\u2068",
        "\u2069",
      ].map((control) => [{ ...item, displayName: `Name${control}` }]),
      ...[
        "\u200b",
        "\u200d",
        "\u2060",
        "\ufe0f",
        "\u034f",
        "\u2800",
        "\u3164",
        " \u200b\u200d ",
      ].map((invisible) => [{ ...item, serviceCode: invisible }]),
    ].map((rows) => ({ rows })),
  )("rejects malformed/oversized repository output %#", async ({ rows }) => {
    const { app } = await build(rows);
    const response = await app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "catalog_unavailable" });
    privacyHeaders(response.headers);
  });
  it("keeps useful joiners within visible names", async () => {
    const joined = { ...item, displayName: "👩‍💻 نام‍" };
    const { app } = await build([joined]);
    expect((await app.inject({ url: "/v1/public/catalog" })).json()).toEqual({
      items: [joined],
    });
  });
  it.each([
    {
      method: "PROPFIND",
      path: "/v1/public/catalog?private=secret",
      chunked: false,
      status: 405,
    },
    {
      method: "MKCOL",
      path: "/v1/public/catalog?private=secret",
      chunked: false,
      status: 405,
    },
    { method: "GET", path: "/v1/public/catalog", chunked: true, status: 400 },
    { method: "HEAD", path: "/v1/public/catalog", chunked: true, status: 400 },
  ])(
    "rejects actual HTTP $method with chunked=$chunked before DB",
    async ({ method, path, chunked, status }) => {
      const { app, listPublicServices } = await build();
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const response = await new Promise<{
        status: number | undefined;
        headers: Record<string, unknown>;
        body: string;
      }>((resolve, reject) => {
        const req = request(
          address,
          {
            method,
            path,
            headers: chunked ? { "transfer-encoding": "chunked" } : {},
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => {
              body += chunk;
            });
            res.on("end", () =>
              resolve({ status: res.statusCode, headers: res.headers, body }),
            );
          },
        );
        req.on("error", reject);
        if (chunked) req.write("private=secret");
        expect(req.getHeader("content-length")).toBeUndefined();
        req.end();
      });
      expect(response.status).toBe(status);
      expect(response.body).not.toContain("secret");
      if (method === "HEAD") expect(response.body).toBe("");
      else
        expect(JSON.parse(response.body)).toEqual({
          error: status === 405 ? "method_not_allowed" : "invalid_request",
        });
      privacyHeaders(response.headers);
      expect(listPublicServices).not.toHaveBeenCalled();
    },
  );
  it("limits all callers and app instances sharing process admission to sixty reads per minute", async () => {
    let now = 0;
    const shared = {
      limiter: createWindowedRateLimiter({ now: () => now }),
      inFlight: 0,
    };
    const first = await build([item], shared);
    const second = await build([item], shared);
    for (let index = 0; index < 60; index++) {
      const { app } = index % 2 ? first : second;
      expect(
        (
          await app.inject({
            url: "/v1/public/catalog",
            remoteAddress: `127.0.0.${index + 1}`,
          })
        ).statusCode,
      ).toBe(200);
    }
    const response = await first.app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: "rate_limited" });
    privacyHeaders(response.headers);
    expect(
      first.listPublicServices.mock.calls.length +
        second.listPublicServices.mock.calls.length,
    ).toBe(60);
    now = 60_000;
    expect(
      (await second.app.inject({ url: "/v1/public/catalog" })).statusCode,
    ).toBe(200);
  });
  it("bounds HTTP waits to 3s but holds both slots until late DB settlement across app instances", async () => {
    const shared = { limiter: createWindowedRateLimiter(), inFlight: 0 };
    const first = await build([item], shared);
    const second = await build([item], shared);
    await Promise.all([first.app.ready(), second.app.ready()]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const a = Promise.withResolvers<unknown>();
    const b = Promise.withResolvers<unknown>();
    const enteredA = Promise.withResolvers<void>();
    const enteredB = Promise.withResolvers<void>();
    first.listPublicServices.mockImplementationOnce(() => {
      enteredA.resolve();
      return a.promise;
    });
    second.listPublicServices.mockImplementationOnce(() => {
      enteredB.resolve();
      return b.promise;
    });
    const pendingA = first.app
      .inject({ url: "/v1/public/catalog" })
      .then((response) => response);
    const pendingB = second.app
      .inject({ url: "/v1/public/catalog" })
      .then((response) => response);
    await Promise.all([enteredA.promise, enteredB.promise]);
    const busy = await first.app.inject({ url: "/v1/public/catalog" });
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toEqual({ error: "catalog_unavailable" });
    privacyHeaders(busy.headers);
    await vi.advanceTimersByTimeAsync(3_000);
    for (const response of await Promise.all([pendingA, pendingB])) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: "catalog_unavailable" });
      privacyHeaders(response.headers);
    }
    expect(
      (await second.app.inject({ url: "/v1/public/catalog" })).statusCode,
    ).toBe(503);
    expect(first.listPublicServices).toHaveBeenCalledTimes(1);
    expect(second.listPublicServices).toHaveBeenCalledTimes(1);
    a.resolve([item]);
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (await first.app.inject({ url: "/v1/public/catalog" })).statusCode,
    ).toBe(200);
    b.reject(new Error("late private database failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(
      (await second.app.inject({ url: "/v1/public/catalog" })).statusCode,
    ).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("accepts maximum field lengths and twenty records without truncation", async () => {
    const boundary = {
      displayName: "n".repeat(200),
      serviceCode: "s".repeat(64),
      language: "l".repeat(32),
    };
    const { app } = await build(new Array(20).fill(boundary));
    const response = await app.inject({ url: "/v1/public/catalog" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: new Array(20).fill(boundary) });
  });
  it.each([
    {
      method: "GET",
      suffix: "?private=secret",
      payload: undefined,
      status: 400,
    },
    {
      method: "HEAD",
      suffix: "?private=secret",
      payload: undefined,
      status: 400,
    },
    { method: "GET", suffix: "", payload: "private secret", status: 400 },
    { method: "HEAD", suffix: "", payload: "private secret", status: 400 },
    ...["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"].map((method) => ({
      method,
      suffix: "",
      payload: "private secret",
      status: 405,
    })),
  ])(
    "rejects $method $suffix before reading or echoing input",
    async ({ method, suffix, payload, status }) => {
      const { app, listPublicServices, resolve } = await build();
      const response = await app.inject({
        method: method as NonNullable<InjectOptions["method"]>,
        url: `/v1/public/catalog${suffix}`,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode).toBe(status);
      expect(response.body).not.toContain("secret");
      if (status === 405) expect(response.headers.allow).toBe("GET, HEAD");
      privacyHeaders(response.headers);
      expect(listPublicServices).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  it("rejects an empty query delimiter on the actual transport", async () => {
    // inject normalizes away a trailing '?'; Node's raw path preserves it.
    const { app, listPublicServices } = await build();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await new Promise<{
      status: number | undefined;
      headers: Record<string, unknown>;
      body: string;
    }>((resolve, reject) => {
      const req = request(
        `${address}/v1/public/catalog`,
        { path: "/v1/public/catalog?" },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            body += chunk;
          });
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "invalid_request" });
    privacyHeaders(response.headers);
    expect(listPublicServices).not.toHaveBeenCalled();
  });
});
