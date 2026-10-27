import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import { expect, it } from "vitest";

it("renders calendar/cancellation pending distinctly and retains truthful empty catalogue in Chrome", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ii-tonya-planerka-browser-"));
  const server = await createServer({
    root: resolve("apps/web"),
    configFile: false,
    envDir: false,
    appType: "custom",
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  server.middlewares.use((req, res, next) => {
    if (req.url !== "/__planerka") return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><meta charset="utf-8"><body><script type="module">
      import {bookingStateText,renderBookingChoices} from '/src/booking-view.ts';
      const base={bookingHandle:'bk1.'+'A'.repeat(43),startsAt:'2026-10-20T10:00:00Z',reservedUntil:'2026-10-19T10:00:00Z'};
      const pending=bookingStateText({...base,state:'calendar_pending'});
      const cancel=bookingStateText({...base,state:'cancellation_pending'});
      const booked=bookingStateText({...base,state:'booked'});
      document.body.innerHTML='<section id="pending"></section><section id="cancel"></section><section id="booked"></section><section id="empty"></section>';
      document.querySelector('#pending').textContent=pending;document.querySelector('#cancel').textContent=cancel;document.querySelector('#booked').textContent=booked;
      document.querySelector('#empty').innerHTML=renderBookingChoices([],true);
      const ok=pending.includes('Ожидаем подтверждения календаря')&&!pending.includes('Встреча подтверждена')&&cancel.includes('Проверяем отмену')&&booked.includes('Встреча подтверждена')&&document.querySelector('#empty').textContent.includes('Нет доступного времени')&&!document.querySelector('#empty button');
      document.body.insertAdjacentHTML('beforeend','<p id="result">'+(ok?'PASS':'FAIL')+'</p>');
    </script></body></html>`);
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("missing_listener");
    const result = await promisify(execFile)(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-background-networking",
        "--no-first-run",
        `--user-data-dir=${directory}`,
        "--virtual-time-budget=5000",
        "--dump-dom",
        `http://127.0.0.1:${address.port}/__planerka`,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024 },
    );
    expect(result.stdout).toContain('<p id="result">PASS</p>');
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
