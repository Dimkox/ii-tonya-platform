import { expect, it, vi } from "vitest";
import { ExpertAccountClient } from "./expert-account-client.js";
import { renderExpertAccountPage } from "./expert-account-view.js";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createHmac } from "node:crypto";
import { createServer } from "vite";
import { sql } from "drizzle-orm";
import { loadEnv } from "../../../packages/config/src/env.js";
import { startExpertReferralTestDatabase } from "../../../packages/db/src/testkit/expert-referral.js";
import { createDefaultLifecycle } from "../../api/src/server.js";
import { buildApp } from "../../api/src/app.js";
const response = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status });
it("probe and login cannot restore authority while DELETE is pending; duplicate logout sends once", async () => {
  let finish!: (r: Response) => void;
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: true,
        csrfToken: "a".repeat(64),
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  const client = new ExpertAccountClient(request);
  await client.probe();
  const out = client.logout();
  const duplicate = client.logout();
  expect(client.authenticated).toBe(false);
  await expect(client.probe()).rejects.toThrow("expert_session_busy");
  await expect(client.login("mini:synthetic")).rejects.toThrow(
    "expert_session_busy",
  );
  expect(request).toHaveBeenCalledTimes(2);
  finish(response(null, 204));
  await Promise.all([out, duplicate]);
  expect(client.authenticated).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});
it("logout during login waits for cookie response, probes its CSRF privately and revokes without reauthentication", async () => {
  let finish!: (r: Response) => void;
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: false,
        csrfToken: "a".repeat(64),
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    )
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: true,
        csrfToken: "b".repeat(64),
      }),
    )
    .mockResolvedValueOnce(response(null, 204));
  const client = new ExpertAccountClient(request);
  await client.probe();
  const login = client.login("mini:synthetic").catch(() => null);
  const out = client.logout();
  await expect(client.probe()).rejects.toThrow("expert_session_busy");
  finish(response({ authenticated: true, csrfToken: "b".repeat(64) }, 201));
  await Promise.all([login, out]);
  expect(client.authenticated).toBe(false);
  expect(request).toHaveBeenNthCalledWith(
    4,
    "/v1/expert/browser/session",
    expect.objectContaining({
      method: "DELETE",
      headers: { "x-csrf-token": "b".repeat(64) },
    }),
  );
});
it("renders explicit expert entry without financial activation or consent gate", () => {
  const html = renderExpertAccountPage();
  expect(html).toContain("Кабинет эксперта");
  expect(html).toContain("data-expert-login");
  expect(html).toContain("data-expert-logout");
  expect(html).not.toContain('type="checkbox"');
});
it("uses only the expert cookie facade and sends the pre-login CSRF, never a bearer", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: false,
        csrfToken: "a".repeat(64),
      }),
    )
    .mockResolvedValueOnce(
      response({ authenticated: true, csrfToken: "b".repeat(64) }, 201),
    );
  const client = new ExpertAccountClient(request);
  await client.probe();
  await client.login("mini:synthetic");
  expect(client.authenticated).toBe(true);
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/v1/expert/browser/session",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        "x-csrf-token": "a".repeat(64),
        "content-type": "application/json",
      },
      body: JSON.stringify({ identityProof: "mini:synthetic" }),
    }),
  );
});
it("logout immediately fences a deferred authenticated probe", async () => {
  let finish!: (response: Response) => void;
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: true,
        csrfToken: "a".repeat(64),
      }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response(null, 204));
  const client = new ExpertAccountClient(request);
  await client.probe();
  const pending = client.probe();
  const observed = pending.catch(() => null);
  await client.logout();
  finish(
    response({
      available: true,
      authenticated: true,
      csrfToken: "a".repeat(64),
    }),
  );
  await observed;
  expect(client.authenticated).toBe(false);
  expect(request).toHaveBeenCalledTimes(3);
});
it("a newer account probe fences the older reply", async () => {
  let finish!: (response: Response) => void;
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: false,
        csrfToken: "b".repeat(64),
      }),
    );
  const client = new ExpertAccountClient(request);
  const old = client.probe().catch(() => null);
  await client.probe();
  finish(
    response({
      available: true,
      authenticated: true,
      csrfToken: "a".repeat(64),
    }),
  );
  await old;
  expect(client.authenticated).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});
it("denied login stays unauthenticated and exposes no raw server error", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({
        available: true,
        authenticated: false,
        csrfToken: "a".repeat(64),
      }),
    )
    .mockResolvedValueOnce(response({ error: "secret" }, 401));
  const client = new ExpertAccountClient(request);
  await client.probe();
  await expect(client.login("mini:synthetic")).rejects.toThrow(
    "expert_login_denied",
  );
  expect(client.authenticated).toBe(false);
});
it("Chrome renders actual account login/logout through ordinary composition and PG, with no browser bearer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ii-tonya-expert-browser-"));
  const database = await startExpertReferralTestDatabase();
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    expect(
      (await database.db.execute(sql`show server_version_num`)).rows[0],
    ).toEqual({ server_version_num: "170005" });
    const owner = await database.createExpertIdentity({
      externalId: "123456789",
    });
    await database.db.execute(
      sql`update channel_identities set bot_key='expert-bot',external_chat_id=external_id where user_id=${owner.userId}::uuid`,
    );
    await promisify(execFile)(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-days",
        "1",
      ],
      { timeout: 10000 },
    );
    server = await createServer({
      root: resolve("apps/web"),
      configFile: false,
      envDir: false,
      appType: "custom",
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
        hmr: false,
        https: {
          key: await readFile(join(directory, "key.pem")),
          cert: await readFile(join(directory, "cert.pem")),
        },
      },
    });
    const botToken = `123456:${"x".repeat(35)}`;
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 123456789, first_name: "Synthetic" }),
    });
    params.sort();
    params.set(
      "hash",
      createHmac(
        "sha256",
        createHmac("sha256", "WebAppData").update(botToken).digest(),
      )
        .update([...params].map(([k, v]) => `${k}=${v}`).join("\n"))
        .digest("hex"),
    );
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/v1/")) {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        req.on("end", () => {
          void (async () => {
            const result = await app!.inject({
              method: req.method as "GET" | "POST" | "DELETE",
              url: req.url!,
              headers: req.headers,
              payload: Buffer.concat(chunks),
            });
            res.writeHead(result.statusCode, result.headers);
            res.end(result.rawPayload);
          })().catch(() => {
            res.statusCode = 500;
            res.end();
          });
        });
        return;
      }
      if (req.url !== "/expert/account") return next();
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<html><meta charset="utf-8"><body><div id="app"></div><script>window.Telegram={WebApp:{initData:${JSON.stringify(params.toString())}}};</script><script type="module">
    const wait=async(predicate)=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw Error('render_timeout');};
    try{await import('/src/main.ts');await wait(()=>document.querySelector('[data-expert-login]')?.disabled===false);document.querySelector('[data-expert-login]').click();await wait(()=>document.querySelector('[data-expert-status]')?.textContent.includes('Вход выполнен'));
    const current=await (await fetch('/v1/expert/browser/session')).json();if(current.userId!==${JSON.stringify(owner.userId)}||current.expertId!==${JSON.stringify(owner.expertId)}||'accessToken' in current)throw Error('identity');
    if(document.cookie.includes('expert-session')||localStorage.length||sessionStorage.length||document.querySelector('#app').innerHTML.includes('es1.'))throw Error('token_leak');
    document.querySelector('[data-expert-logout]').click();const retry=document.querySelector('[data-expert-retry]');if(!retry.disabled)throw Error('logout_retry_unfenced');retry.click();retry.onclick?.();await wait(()=>document.querySelector('[data-expert-status]')?.textContent==='Войдите через Telegram.');
    const final=await (await fetch('/v1/expert/browser/session')).json();if(final.authenticated)throw Error('not_revoked');document.body.insertAdjacentHTML('beforeend','<p id="result">PASS</p>');
    }catch(error){document.body.insertAdjacentHTML('beforeend','<p id="result">FAIL:'+error.message+'</p>');}
   </script></body></html>`);
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("missing_listener");
    const origin = `https://127.0.0.1:${address.port}`;
    app = await buildApp(
      await createDefaultLifecycle().dependencies(
        loadEnv({
          DATABASE_URL: "postgresql://local:local@localhost/test",
          ALLOW_INSECURE_LOCAL_DATABASE: "true",
          EXPERT_SESSION_ENABLED: "true",
          EXPERT_TELEGRAM_BOT_TOKEN: botToken,
          EXPERT_TELEGRAM_BOT_KEY: "expert-bot",
          EXPERT_WEB_ORIGIN: origin,
          EXPERT_TELEGRAM_LOGIN_BOT_USERNAME: "expert_test_bot",
        }),
        database.db,
      ),
    );
    const result = await promisify(execFile)(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        "--ignore-certificate-errors",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
        `--user-data-dir=${join(directory, "profile")}`,
        "--virtual-time-budget=15000",
        "--dump-dom",
        `${origin}/expert/account`,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const rendered = result.stdout.replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/giu,
      "",
    );
    expect(rendered).toContain('<p id="result">PASS</p>');
    expect(rendered).not.toContain('<p id="result">FAIL:');
    expect(
      (
        await database.db.execute(
          sql`select count(*)::int total,count(revoked_at)::int revoked from expert_sessions`,
        )
      ).rows,
    ).toEqual([{ total: 1, revoked: 1 }]);
  } finally {
    await server?.close();
    await app?.close();
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
