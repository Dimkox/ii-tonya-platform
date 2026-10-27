import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "vite";
import { expect, it } from "vitest";

// Real production bundle, browser input and download. No browser automation dependency.
it("walks through the isolated demo in mobile Chrome with real CSS and reload", async () => {
  const bundle = await build({
    root: resolve("apps/web"),
    configFile: false,
    envDir: false,
    logLevel: "silent",
    build: { write: false },
  });
  if (!("output" in bundle)) throw new Error("expected a single web bundle");
  const assets = new Map(
    bundle.output.map((asset) => [
      `/${asset.fileName}`,
      asset.type === "asset" ? asset.source : asset.code,
    ]),
  );
  // In-memory Vite output omits publicDir files; serve the real shell favicon too.
  assets.set(
    "/favicon.png",
    await readFile(resolve("apps/web/public/favicon.png")),
  );
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    requests.push(path);
    const asset = assets.get(
      path === "/demo" || path === "/demo/" ? "/index.html" : path,
    );
    if (asset === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".png")
            ? "image/png"
            : "text/html; charset=utf-8",
    );
    res.end(asset);
  });
  let directory: string | undefined;
  let terminateChrome: (() => Promise<void>) | undefined;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("listener");
    const origin = `http://127.0.0.1:${address.port}`;
    directory = await mkdtemp(
      join(tmpdir(), "ii-tonya-demo-walkthrough-chrome-"),
    );
    const chrome = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--no-first-run",
        "--disable-background-networking",
        "--disable-component-update",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        "--remote-debugging-pipe",
        `--user-data-dir=${join(directory, "profile")}`,
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    // Register immediately: cleanup must also work after spawn failure or early exit.
    let terminated = false;
    let terminalError: Error | undefined;
    const termination = new Promise<void>((resolveTermination) => {
      const finish = () => {
        terminated = true;
        resolveTermination();
      };
      chrome.once("exit", finish);
      chrome.once("error", (error) => {
        terminalError = error;
        // A failed spawn has no process to wait for; a kill error is not an exit.
        if (chrome.pid === undefined) finish();
      });
    });
    const waitForTermination = (milliseconds: number) =>
      new Promise<boolean>((resolveWait) => {
        const timeout = setTimeout(() => resolveWait(false), milliseconds);
        void termination.then(() => {
          clearTimeout(timeout);
          resolveWait(true);
        });
      });
    terminateChrome = async () => {
      if (terminated) return;
      chrome.kill("SIGTERM");
      if (await waitForTermination(1500)) return;
      chrome.kill("SIGKILL");
      if (!(await waitForTermination(2000)))
        throw new Error("Chrome did not terminate after SIGKILL");
    };
    chrome.stderr?.resume();
    const input = chrome.stdio[3] as Writable;
    const output = chrome.stdio[4] as Readable;
    type Reply = Record<string, unknown>;
    const pending = new Map<
      number,
      { resolve: (reply: Reply) => void; reject: (error: Error) => void }
    >();
    const network: string[] = [];
    const errors: unknown[] = [];
    let nextId = 0;
    let buffer = "";
    let sessionId: string | undefined = undefined;
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      buffer += chunk;
      for (
        let end = buffer.indexOf("\0");
        end >= 0;
        end = buffer.indexOf("\0")
      ) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.method === "Network.requestWillBeSent")
          network.push(message.params.request.url);
        if (message.method === "Runtime.exceptionThrown")
          errors.push(message.params);
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error)
          waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
      }
    });
    const rejectPending = (error: Error) => {
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
    };
    chrome.on("error", rejectPending);
    chrome.on("exit", () => rejectPending(new Error("browser exited")));
    input.on("error", rejectPending);
    const send = (method: string, params: Reply = {}, session = sessionId) =>
      new Promise<Reply>((resolveReply, reject) => {
        if (terminated || terminalError) {
          reject(terminalError ?? new Error("browser exited"));
          return;
        }
        const id = ++nextId;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 8000);
        pending.set(id, {
          resolve: (reply) => {
            clearTimeout(timeout);
            resolveReply(reply);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        input.write(
          JSON.stringify({
            id,
            method,
            params,
            ...(session ? { sessionId: session } : {}),
          }) + "\0",
        );
      });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const reply = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (reply.exceptionDetails)
        throw new Error(JSON.stringify(reply.exceptionDetails));
      return (reply.result as { value: T }).value;
    };
    const waitFor = async (expression: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate<boolean>(expression)) return;
        await delay(30);
      }
      throw new Error(`Browser condition not reached: ${expression}`);
    };
    const click = (name: string) =>
      evaluate(`document.querySelector('[data-demo-${name}]').click()`);
    const state = () =>
      evaluate<string>(
        "document.querySelector('[data-demo-booking]').dataset.state",
      );
    const select = async () => {
      await evaluate(`for (const [name,value] of [['service','demo-2'],['time','example-evening']]) {
      const element = document.querySelector('[data-demo-' + name + ']');
      element.value = value; element.dispatchEvent(new Event('change', {bubbles:true}));
    }`);
    };
    const target = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    sessionId = attached.sessionId as string;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: directory,
    });
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
      window.demoAudit = {forbidden: [], urls: [], revoked: []};
      const deny = name => function() {window.demoAudit.forbidden.push(name); throw Error('Forbidden: ' + name)};
      for (const name of ['fetch','XMLHttpRequest','WebSocket','EventSource']) window[name] = deny(name);
      navigator.sendBeacon = deny('beacon');
      for (const name of ['localStorage','sessionStorage']) Object.defineProperty(window, name, {get: deny(name)});
      Object.defineProperty(document, 'cookie', {get: deny('cookie read'), set: deny('cookie write')});
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => {const url = create(blob); window.demoAudit.urls.push(url); return url};
      URL.revokeObjectURL = url => {window.demoAudit.revoked.push(url); return revoke(url)};
    `,
    });
    await send("Page.navigate", { url: `${origin}/demo` });
    await waitFor("document.readyState === 'complete'");
    expect(
      await evaluate("!!document.querySelector('[data-demo-banner]')"),
    ).toBe(true);
    expect(await state()).toBe("none");
    expect(
      await evaluate("document.querySelector('[data-demo-pay]').disabled"),
    ).toBe(true);
    expect(
      await evaluate("document.querySelector('[data-demo-reserve]').disabled"),
    ).toBe(true);
    expect(
      await evaluate("document.querySelector('[data-demo-consent]').checked"),
    ).toBe(false);
    expect(
      await evaluate(
        "document.querySelectorAll('textarea, input:not([type=checkbox]), iframe, form').length",
      ),
    ).toBe(0);
    expect(
      await evaluate(
        "document.querySelector('[data-demo-service]').options.length",
      ),
    ).toBe(7);
    await select();
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-selection]').textContent",
      ),
    ).toContain("Коучинг целей");
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-selection]').textContent",
      ),
    ).toContain("Пример дня · 18:00");

    // Exercise native keyboard activation, then repeated clicks and focus handoff.
    await evaluate("document.querySelector('[data-demo-reserve]').focus()");
    expect(
      await evaluate(
        "document.activeElement.hasAttribute('data-demo-reserve')",
      ),
    ).toBe(true);
    expect(
      await evaluate("document.querySelector('[data-demo-reserve]').disabled"),
    ).toBe(false);
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      // CDP does not infer a keypress character from the logical key name.
      text: "\r",
      unmodifiedText: "\r",
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    expect(await state()).toBe("reserved");
    expect(
      await evaluate("document.activeElement.hasAttribute('data-demo-status')"),
    ).toBe(true);
    await click("reserve");
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    expect(
      await evaluate("document.activeElement.hasAttribute('data-demo-pay')"),
    ).toBe(true);
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
      text: " ",
      unmodifiedText: " ",
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
    });
    expect(await state()).toBe("simulated-paid");
    await click("pay");
    expect(await state()).toBe("simulated-paid");
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-status]').textContent",
      ),
    ).toContain("не списаны");
    await click("consent");
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-consent-status]').textContent",
      ),
    ).toContain("Демо-согласие дано");
    await click("export");
    let downloaded = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        downloaded = await readFile(
          join(directory, "ii-tonya-synthetic-demo.json"),
          "utf8",
        );
        break;
      } catch {
        await delay(30);
      }
    }
    expect(JSON.parse(downloaded)).toEqual({
      kind: "ii-tonya-synthetic-demo",
      synthetic: true,
      notice: expect.stringContaining("Демо"),
      selection: { service: "Коучинг целей", time: "Пример дня · 18:00" },
      booking: {
        service: "Коучинг целей",
        time: "Пример дня · 18:00",
        status: "simulated-paid",
      },
      consent: "demo-granted",
    });
    await waitFor(
      "window.demoAudit.urls.length === 1 && window.demoAudit.revoked.length === 1",
    );
    expect(
      await evaluate(
        "window.demoAudit.urls[0] === window.demoAudit.revoked[0]",
      ),
    ).toBe(true);
    await click("consent");
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-consent-status]').textContent",
      ),
    ).toContain("Демо-согласие отозвано");
    await click("cancel");
    await click("cancel");
    await click("pay");
    expect(await state()).toBe("cancelled");
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-status]').textContent",
      ),
    ).toContain("не выполнялся");

    for (const width of [390, 320]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await evaluate("window.scrollTo(0, document.body.scrollHeight)");
      expect(
        await evaluate("document.documentElement.scrollWidth <= innerWidth"),
      ).toBe(true);
      expect(
        await evaluate(
          "getComputedStyle(document.querySelector('[data-demo-banner]')).position",
        ),
      ).toBe("sticky");
      expect(
        await evaluate(
          "document.querySelector('[data-demo-banner]').getBoundingClientRect().top",
        ),
      ).toBe(0);
      expect(
        await evaluate(`Array.from(document.querySelectorAll('.demo-page button, .demo-page select')).every(el => {
        const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
      })`),
      ).toBe(true);
    }

    await click("consent");
    await click("clear");
    await click("clear");
    expect(await state()).toBe("none");
    expect(
      await evaluate("document.querySelector('[data-demo-consent]').checked"),
    ).toBe(false);
    expect(
      await evaluate<string>(
        "document.querySelector('[data-demo-status]').textContent",
      ),
    ).toContain("Демо очищено");
    expect(
      await evaluate("document.querySelector('[data-demo-service]').value"),
    ).toBe("");
    await select();
    await click("reserve");
    await click("cancel"); // Cancellation before payment also works in the UI.
    expect(await state()).toBe("cancelled");
    await click("reset");
    await click("reset");
    expect(await state()).toBe("none");
    expect(
      await evaluate(
        "document.activeElement.hasAttribute('data-demo-service')",
      ),
    ).toBe(true);
    await select();
    await click("reserve");
    await click("consent");
    expect(await evaluate("window.demoAudit.forbidden")).toEqual([]);

    await send("Page.reload");
    await waitFor(
      "document.readyState === 'complete' && document.querySelector('[data-demo-booking]')?.dataset.state === 'none'",
    );
    expect(
      await evaluate("document.querySelector('[data-demo-consent]').checked"),
    ).toBe(false);
    expect(
      await evaluate("document.querySelector('[data-demo-service]').value"),
    ).toBe("");
    expect(await evaluate("window.demoAudit.forbidden")).toEqual([]);
    await send("Page.navigate", { url: `${origin}/demo/` });
    await waitFor(
      "location.pathname === '/demo/' && document.readyState === 'complete' && !!document.querySelector('[data-demo-banner]')",
    );
    expect(await state()).toBe("none");
    expect(await evaluate("window.demoAudit.forbidden")).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      network.every(
        (url) => url.startsWith(origin + "/") || url.startsWith("blob:"),
      ),
    ).toBe(true);
    expect(
      requests.filter(
        (path) =>
          !["/demo", "/demo/", "/favicon.ico"].includes(path) &&
          !assets.has(path),
      ),
    ).toEqual([]);
  } finally {
    try {
      await terminateChrome?.();
    } finally {
      try {
        server.closeAllConnections();
        await new Promise<void>((resolveClose) =>
          server.close(() => resolveClose()),
        );
      } finally {
        if (directory)
          await rm(directory, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  }
}, 45000);
