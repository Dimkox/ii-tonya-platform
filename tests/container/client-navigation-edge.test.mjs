import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test(
  "loopback nginx keeps accepted client updates out of temp files and rejects >64KiB",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "ii-tonya-navigation-edge-"));
    const lengths = [];
    let chunkReceived;
    const backend = createServer((req, res) => {
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        chunkReceived?.();
      });
      req.on("end", () => {
        lengths.push(bytes);
        res
          .writeHead(200, { "content-type": "application/json" })
          .end('{"accepted":true}');
      });
    });
    const reserve = createTcpServer();
    let nginx;
    let watcher;
    const stop = async () => {
      if (!nginx || nginx.exitCode !== null || nginx.signalCode !== null)
        return;
      const exited = once(nginx, "exit");
      nginx.kill("SIGQUIT");
      const timer = setTimeout(() => nginx.kill("SIGKILL"), 2000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    };
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
      const configPath = join(dir, "nginx.conf");
      await writeFile(
        configPath,
        `pid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {}\nhttp { client_body_temp_path ${dir}/body; proxy_temp_path ${dir}/proxy; ${config}\n}\n`,
      );
      const binary = process.env.NGINX_BIN || "/usr/sbin/nginx";
      const syntax = spawnSync(binary, ["-t", "-p", dir, "-c", configPath], {
        encoding: "utf8",
      });
      assert.equal(syntax.status, 0, syntax.stderr || "native nginx required");
      nginx = spawn(
        binary,
        ["-p", dir, "-c", configPath, "-g", "daemon off;"],
        { stdio: "ignore" },
      );
      const marker = "SYNTHETIC_PERSONAL_CANARY";
      const path = `/v1/webhooks/telegram/client/${marker}?note=${marker}`;
      const send = (body, contentLength = true) =>
        new Promise((resolve, reject) => {
          const req = request(
            {
              hostname: "127.0.0.1",
              port,
              method: "POST",
              path,
              headers: {
                host: "ii-tonya.ru",
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": marker,
                "x-correlation-id": marker,
                ...(contentLength
                  ? { "content-length": Buffer.byteLength(body) }
                  : {}),
              },
            },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.statusCode));
            },
          );
          req.on("error", reject);
          req.setTimeout(3000, () =>
            req.destroy(new Error("navigation_edge_timeout")),
          );
          req.end(body);
        });
      let ready = false;
      for (let i = 0; i < 40; i++) {
        try {
          await send("{}");
          ready = true;
          break;
        } catch {
          await delay(25);
        }
      }
      assert(ready, "nginx starts on loopback");
      const events = [];
      watcher = watch(join(dir, "body"), { recursive: true }, (_event, name) =>
        events.push(name),
      );
      const body = JSON.stringify({
        update_id: 7,
        text: marker + "x".repeat(65536 - marker.length - 25),
      });
      assert.equal(Buffer.byteLength(body), 65536);
      for (const contentLength of [true, false]) {
        assert.equal(await send(body, contentLength), 200);
        assert.equal(lengths.at(-1), 65536);
        const before = lengths.length;
        assert.equal(await send(`${body}x`, contentLength), 413);
        assert.equal(
          lengths.length,
          before,
          "oversize request never completes at upstream",
        );
      }
      const first = Promise.withResolvers();
      const completed = Promise.withResolvers();
      chunkReceived = first.resolve;
      const stream = request(
        {
          hostname: "127.0.0.1",
          port,
          method: "POST",
          path,
          headers: { host: "ii-tonya.ru" },
        },
        (res) => {
          res.resume();
          res.on("end", () => completed.resolve(res.statusCode));
        },
      );
      stream.on("error", completed.reject);
      stream.write(marker);
      let timer;
      try {
        await Promise.race([
          first.promise,
          new Promise((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("request buffering enabled")),
              1500,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        chunkReceived = undefined;
        stream.end();
      }
      assert.equal(await completed.promise, 200);
      assert.deepEqual(
        events,
        [],
        "no request-body file creation, including transient files",
      );
      assert.deepEqual(await readdir(join(dir, "body")), []);
      assert.deepEqual(await readdir(join(dir, "proxy")), []);
      backend.closeAllConnections();
      await new Promise((resolve) => backend.close(resolve));
      assert.equal(await send(marker), 502);
      await stop();
      for (const name of ["access.log", "error.log"])
        assert(
          !(await readFile(join(dir, name), "utf8")).includes(marker),
          `${name} must not contain input`,
        );
    } finally {
      watcher?.close();
      await stop();
      backend.closeAllConnections();
      await new Promise((resolve) => backend.close(resolve));
      if (reserve.listening)
        await new Promise((resolve) => reserve.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
