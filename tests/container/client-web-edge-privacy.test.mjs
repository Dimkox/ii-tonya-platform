import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

async function stopNginx(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGQUIT");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

// Requires the native nginx binary, not a mock. TLS/path substitutions only
// isolate the fixture; the deployed locations and logging directives are used.
test("nginx account routes never log request content or identifying headers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ii-tonya-edge-privacy-"));
  const receivedLengths = [];
  let chunkReceived;
  const backend = createServer((req, res) => {
    if (req.url?.endsWith("/privacy/export")) {
      res.writeHead(200, { "X-Accel-Buffering": "yes" });
      res.end(Buffer.alloc(16 * 1024 * 1024, "x"));
      return;
    }
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      chunkReceived?.();
    });
    req.on("end", () => {
      receivedLengths.push(bytes);
      res.writeHead(503).end();
    });
  });
  const reserve = createTcpServer();
  let nginx;
  try {
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const config = (await readFile("deploy/nginx/ii-tonya", "utf8"))
      .replace(/listen \[::\]:443 ssl ipv6only=on;/u, "")
      .replace(/listen 443 ssl;/u, `listen 127.0.0.1:${port};`)
      .replace(
        /listen 80 default_server;/u,
        `listen unix:${dir}/redirect.sock;`,
      )
      .replace(/listen \[::\]:80 default_server;/u, "")
      .replace(
        /^\s*(?:ssl_certificate|ssl_certificate_key|ssl_dhparam|include) .*;$/gmu,
        "",
      )
      .replaceAll("/opt/ii-tonya-platform/web-current", dir)
      .replaceAll(
        "http://127.0.0.1:3000",
        `http://127.0.0.1:${backend.address().port}`,
      )
      .replaceAll(
        "/var/log/nginx/ii-tonya-access.log",
        join(dir, "access.log"),
      );
    await writeFile(join(dir, "index.html"), "Synthetic account fixture");
    await writeFile(
      join(dir, "nginx.conf"),
      `pid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {}\nhttp {\nclient_body_temp_path ${dir}/body;\nproxy_temp_path ${dir}/proxy;\naccess_log ${dir}/access.log combined;\n${config}\n}\n`,
    );
    const binary = process.env.NGINX_BIN || "/usr/sbin/nginx";
    const syntax = spawnSync(
      binary,
      ["-t", "-p", dir, "-c", join(dir, "nginx.conf")],
      { encoding: "utf8" },
    );
    assert.equal(syntax.status, 0, syntax.stderr || "nginx binary required");
    nginx = spawn(
      binary,
      ["-p", dir, "-c", join(dir, "nginx.conf"), "-g", "daemon off;"],
      { stdio: "ignore" },
    );
    const get = (path, headers = {}, redirect = false, body, method) =>
      new Promise((resolve, reject) => {
        const req = request(
          {
            ...(redirect
              ? { socketPath: `${dir}/redirect.sock` }
              : { hostname: "127.0.0.1", port }),
            path,
            method: method ?? (body === undefined ? "GET" : "POST"),
            headers: { host: "ii-tonya.ru", ...headers },
          },
          (res) => {
            if (path === "/account")
              assert.equal(res.headers["referrer-policy"], "no-referrer");
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", reject);
        req.setTimeout(5000, () =>
          req.destroy(new Error("edge_fixture_timeout")),
        );
        req.end(body);
      });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        await get("/health/ready");
        ready = true;
        break;
      } catch {
        await delay(25);
      }
    }
    assert(ready, "isolated nginx must start");
    const marker = "SYNTHETIC_SECRET_DO_NOT_LOG";
    await get("/account");
    assert.equal(await get("/account", {}, false, undefined, marker), 405);
    assert.equal(
      await get(`/account?identityProof=${marker}`, {
        referer: `https://example.invalid/${marker}`,
        cookie: `test=${marker}`,
        "user-agent": marker,
      }),
      200,
    );
    assert.equal(
      await get(`/v1/browser/session?identityProof=${marker}`, {
        authorization: `Bearer ${marker}`,
      }),
      503,
    );
    assert.equal(await get(`/account?identityProof=${marker}`, {}, true), 301);
    assert.equal(
      await get("/v1/browser/session", {}, false, marker.repeat(512)),
      413,
      "oversized authentication bodies must be rejected by nginx before forwarding",
    );
    for (const endpoint of ["/v1/browser/session", "/v1/client/sessions"]) {
      assert.equal(
        await get(
          endpoint,
          { "content-length": "8192" },
          false,
          "a".repeat(8192),
        ),
        503,
      );
      assert.equal(receivedLengths.at(-1), 8192);
      const count = receivedLengths.length;
      assert.equal(
        await get(
          endpoint,
          { "content-length": "8193" },
          false,
          "a".repeat(8193),
        ),
        413,
      );
      assert.equal(receivedLengths.length, count);
    }
    for (const endpoint of ["/v1/browser/session", "/v1/client/sessions"]) {
      const firstChunk = Promise.withResolvers();
      chunkReceived = firstChunk.resolve;
      const streamed = Promise.withResolvers();
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path: endpoint,
          method: "POST",
          headers: { host: "ii-tonya.ru" },
        },
        (res) => {
          res.resume();
          res.on("end", () => streamed.resolve(res.statusCode));
        },
      );
      req.on("error", streamed.reject);
      req.write("first-chunk");
      let timeout;
      try {
        const arrived = await Promise.race([
          firstChunk.promise.then(() => true),
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(false), 1000);
          }),
        ]);
        assert(
          arrived,
          "request bytes must reach backend before request completion",
        );
      } finally {
        clearTimeout(timeout);
        req.end();
        chunkReceived = undefined;
      }
      assert.equal(await streamed.promise, 503);
    }
    const spoolEvents = [];
    const watcher = watch(
      join(dir, "proxy"),
      { recursive: true },
      (_event, name) => spoolEvents.push(name),
    );
    try {
      for (const endpoint of [
        "/v1/browser/privacy/export",
        "/v1/client/privacy/export",
      ]) {
        await new Promise((resolve, reject) => {
          const req = request(
            {
              hostname: "127.0.0.1",
              port,
              path: endpoint,
              headers: { host: "ii-tonya.ru" },
            },
            (res) => {
              res.pause();
              let bytes = 0;
              res.on("data", (chunk) => {
                bytes += chunk.length;
              });
              res.on("end", () => {
                try {
                  assert.equal(res.statusCode, 200);
                  assert.equal(bytes, 16 * 1024 * 1024);
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
              setTimeout(() => res.resume(), 150);
            },
          );
          req.on("error", reject);
          req.setTimeout(5000, () => req.destroy(new Error("export_timeout")));
          req.end();
        });
      }
      assert.deepEqual(
        spoolEvents,
        [],
        "private exports must not create temporary files even when upstream requests buffering",
      );
    } finally {
      watcher.close();
    }
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
    assert.equal(await get(`/v1/browser/session?identityProof=${marker}`), 502);
    await stopNginx(nginx);
    const access = await readFile(join(dir, "access.log"), "utf8");
    const errors = await readFile(join(dir, "error.log"), "utf8");
    assert(
      !access.includes(marker),
      "access log must exclude query, referrer and identifying headers",
    );
    assert(
      !errors.includes(marker),
      "error log must exclude raw request context",
    );
    const lines = access.trim().split("\n");
    assert(
      lines.length >= 3,
      "status-only operational evidence remains available",
    );
    assert(
      lines.every((line) =>
        /^(?:GET|POST|OTHER) (?:200|301|405|413|502|503) \d+\.\d{3}$/u.test(
          line,
        ),
      ),
      access,
    );
  } finally {
    await stopNginx(nginx);
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
    if (reserve.listening)
      await new Promise((resolve) => reserve.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
