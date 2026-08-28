import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);

describe("public HTML shell", () => {
  it("loads the configured Yandex Metrika counter once with its tracking options", () => {
    const inlineScripts = [
      ...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/gu),
    ].map(([, source]) => source);
    const bootstrap = inlineScripts.find((source) =>
      source?.includes("mc.yandex.ru/metrika/tag.js"),
    );

    expect(bootstrap).toBeDefined();
    if (bootstrap === undefined) return;

    type ScriptNode = { async?: number; src?: string };
    const insertedScripts: ScriptNode[] = [];
    const createdTags: string[] = [];
    const firstScript = {
      parentNode: {
        insertBefore(node: ScriptNode) {
          insertedScripts.push({ ...node });
        },
      },
    };
    const sandbox: Record<string, unknown> = {
      document: {
        scripts: [],
        referrer: "https://example.test/source",
        createElement(tag: string) {
          createdTags.push(tag);
          return {};
        },
        getElementsByTagName(tag: string) {
          createdTags.push(tag);
          return [firstScript];
        },
      },
      location: { href: "https://ii-tonya.ru/" },
    };
    sandbox.window = sandbox;

    runInNewContext(bootstrap, sandbox);

    expect(createdTags).toEqual(["script", "script"]);
    expect(insertedScripts).toEqual([
      {
        async: 1,
        src: "https://mc.yandex.ru/metrika/tag.js?id=111827123",
      },
    ]);
    const queuedCalls = (sandbox.ym as { a: Array<ArrayLike<unknown>> }).a;
    expect(queuedCalls).toHaveLength(1);
    const initCall = Array.from(queuedCalls[0] ?? []);
    expect(initCall.slice(0, 2)).toEqual([111827123, "init"]);
    expect(JSON.parse(JSON.stringify(initCall[2]))).toEqual({
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: "dataLayer",
      referrer: "https://example.test/source",
      url: "https://ii-tonya.ru/",
      accurateTrackBounce: true,
      trackLinks: true,
    });

    (sandbox.document as { scripts: ScriptNode[] }).scripts = insertedScripts;
    runInNewContext(bootstrap, sandbox);

    expect(createdTags).toEqual(["script", "script"]);
    expect(insertedScripts).toHaveLength(1);
    expect((sandbox.ym as { a: Array<ArrayLike<unknown>> }).a).toHaveLength(2);
  });

  it("retains the configured Metrika image fallback and guidance without JavaScript", () => {
    const noScriptContent = indexHtml.match(
      /<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/u,
    )?.[1];

    expect(noScriptContent).toContain(
      'src="https://mc.yandex.ru/watch/111827123"',
    );
    expect(noScriptContent).toContain(
      "Для открытия диалога и полной навигации включите JavaScript.",
    );
  });
});
