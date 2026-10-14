import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = new URL("..", import.meta.url).pathname;
const outputDirectory = mkdtempSync(join(tmpdir(), "ii-tonya-web-"));
let document = "";

beforeAll(() => {
  execFileSync(
    "npm",
    ["run", "build", "--", "--outDir", outputDirectory, "--emptyOutDir"],
    { cwd: projectRoot, stdio: "pipe" },
  );
  document = readFileSync(join(outputDirectory, "index.html"), "utf8");
});

afterAll(() => {
  rmSync(outputDirectory, { recursive: true, force: true });
});

describe("production landing prerender", () => {
  it("publishes the complete landing in raw HTML before JavaScript runs", () => {
    expect(document).toContain("<h1>Привет, я ии-Тоня");
    expect(document.match(/<details\b/gu)).toHaveLength(20);
    expect(document.match(/<main\b/gu)).toHaveLength(1);
    expect(document).toContain('data-prerendered="true"');
    expect(document).not.toContain('<main id="app"></main>');
  });

  it("keeps the first-load JavaScript below the 15 KB skill budget", () => {
    const script = document.match(/<script type="module"[^>]+src="([^"]+)"/u);
    expect(script).not.toBeNull();
    const scriptPath = script?.[1]?.replace(/^\//u, "") ?? "";
    expect(statSync(join(outputDirectory, scriptPath)).size).toBeLessThanOrEqual(
      15 * 1024,
    );
  });
});
