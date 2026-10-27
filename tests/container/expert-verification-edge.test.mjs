import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createServer as tcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test("actual staff view and protected API are no-store behind native nginx", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ii-tonya-staff-edge-"));
  const backend = createServer((_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.end('{"kind":"ok","items":[]}');
  });
  const reserve = tcpServer();
  let child;
  try {
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    reserve.listen(0, "127.0.0.1");
    await once(reserve, "listening");
    const port = reserve.address().port;
    await new Promise((r) => reserve.close(r));
    const source = (await readFile("deploy/nginx/ii-tonya", "utf8"))
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
    await writeFile(
      join(dir, "index.html"),
      "Synthetic staff shell; no token or contact embedded",
    );
    await writeFile(
      join(dir, "nginx.conf"),
      `pid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {}\nhttp { client_body_temp_path ${dir}/body;proxy_temp_path ${dir}/proxy;${source}\n}`,
    );
    const binary = process.env.NGINX_BIN || "/usr/sbin/nginx";
    const syntax = spawnSync(
      binary,
      ["-t", "-p", dir, "-c", join(dir, "nginx.conf")],
      { encoding: "utf8" },
    );
    assert.equal(syntax.status, 0, syntax.stderr);
    child = spawn(
      binary,
      ["-p", dir, "-c", join(dir, "nginx.conf"), "-g", "daemon off;"],
      { stdio: "ignore" },
    );
    const get = (path) =>
      new Promise((resolve, reject) => {
        const q = request(
          {
            host: "127.0.0.1",
            port,
            path,
            headers: {
              host: "ii-tonya.ru",
              authorization: "Bearer synthetic_staff_edge_canary",
            },
          },
          (res) => {
            let body = "";
            res.on("data", (x) => (body += x));
            res.on("end", () =>
              resolve({ status: res.statusCode, headers: res.headers, body }),
            );
          },
        );
        q.on("error", reject);
        q.end();
      });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        await get("/");
        ready = true;
        break;
      } catch {
        await delay(20);
      }
    }
    assert.equal(ready, true, "native nginx readiness");
    for (const path of [
      "/admin/expert-verification",
      "/admin/expert-verification/",
      "/v1/admin/expert-verification",
    ]) {
      const r = await get(path);
      assert.equal(r.status, 200);
      assert.equal(r.headers["cache-control"], "no-store", path);
      assert.equal(r.body.includes("synthetic_staff_edge_canary"), false);
    }
    child.kill("SIGQUIT");
    await once(child, "exit");
    child = undefined;
    assert.equal(
      (await readFile(join(dir, "access.log"), "utf8")).includes(
        "synthetic_staff_edge_canary",
      ),
      false,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    if (backend.listening) await new Promise((r) => backend.close(r));
    if (reserve.listening) await new Promise((r) => reserve.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
