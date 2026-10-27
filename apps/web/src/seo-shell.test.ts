import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const projectRoot = new URL("..", import.meta.url).pathname;
const outputDirectory = mkdtempSync(join(tmpdir(), "ii-tonya-seo-"));
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

describe("production SEO shell", () => {
  it("publishes canonical and complete social metadata", () => {
    expect(document).toMatch(
      /<link\s+rel="canonical"\s+href="https:\/\/ii-tonya\.ru\/"\s*\/?>/u,
    );
    expect(document).toMatch(
      /<meta\s+property="og:url"\s+content="https:\/\/ii-tonya\.ru\/"\s*\/?>/u,
    );
    expect(document).toContain('property="og:image"');
    expect(document).toContain('property="og:image:alt"');
    expect(document).toContain(
      'name="twitter:card" content="summary_large_image"',
    );
    expect(document).toContain('name="twitter:image"');
  });

  it("publishes truthful WebSite, Organization and FAQ structured data", () => {
    const match = document.match(
      /<script id="landing-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/u,
    );
    expect(match).not.toBeNull();
    const graph = JSON.parse(match?.[1] ?? "{}") as {
      readonly "@graph": ReadonlyArray<{ readonly "@type": string }>;
    };
    expect(graph["@graph"].map((entry) => entry["@type"])).toEqual([
      "WebSite",
      "Organization",
      "FAQPage",
    ]);
    expect(match?.[1]).not.toMatch(/LocalBusiness|AggregateRating|Review/u);
  });

  it("ships crawlability and brand asset files", () => {
    expect(readFileSync(join(outputDirectory, "robots.txt"), "utf8")).toContain(
      "Sitemap: https://ii-tonya.ru/sitemap.xml",
    );
    expect(
      readFileSync(join(outputDirectory, "sitemap.xml"), "utf8"),
    ).toContain("<loc>https://ii-tonya.ru/</loc>");
    expect(existsSync(join(outputDirectory, "favicon.png"))).toBe(true);
  });
});
