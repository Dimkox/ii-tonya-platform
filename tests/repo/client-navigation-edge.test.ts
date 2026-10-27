import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
const nginx = readFileSync("deploy/nginx/ii-tonya", "utf8");
const { scripts } = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
it("exposes both native edge proofs separately from image and unit tests", () => {
  expect(scripts["test:edge:native"]).toBeTypeOf("string");
  const run = spawnSync(
    "bash",
    ["-c", `node() { printf '%s\\n' "$@"; }; ${scripts["test:edge:native"]}`],
    { encoding: "utf8" },
  );
  expect(run.status).toBe(0);
  expect(run.stdout.trim().split("\n")).toEqual([
    "--test",
    "tests/container/client-navigation-edge.test.mjs",
    "tests/container/client-web-edge-privacy.test.mjs",
  ]);
  expect(scripts["test:container"]).toBe(
    "node --test tests/container/image-smoke.test.mjs tests/container/sandbox-image-smoke.test.mjs",
  );
  expect(scripts["test:unit"]).toBe("vitest run packages apps");
});
it.each([0, 23])(
  "deployment verification invokes native edge proof and propagates exit %s",
  (exitCode) => {
    // Intercept only external test commands; execute the actual deployment script's
    // shell control flow and syntax checks without requiring nginx for unit tests.
    const run = spawnSync(
      "bash",
      [
        "-c",
        `vitest() { return 0; }; pnpm() { printf '%s\\n' "$*"; return ${exitCode}; }; ${scripts["verify:deploy"]}`,
      ],
      { encoding: "utf8" },
    );
    expect(run.stdout.trim()).toBe("test:edge:native");
    expect(run.status).toBe(exitCode);
  },
);
it("sets a distinct client-webhook no-spooling boundary while preserving browser limits and TLS", () => {
  const client = nginx.match(
    /location \^~ \/v1\/webhooks\/telegram\/client\/ \{([^}]+)\}/u,
  )?.[1];
  expect(client).toBeDefined();
  for (const directive of [
    "client_max_body_size 64k;",
    "client_body_buffer_size 128k;",
    "client_body_in_file_only off;",
    "proxy_request_buffering off;",
    "proxy_http_version 1.1;",
    "proxy_buffering off;",
    "proxy_cache off;",
  ])
    expect(client).toContain(directive);
  expect(nginx).toContain("client_max_body_size 8k;");
  expect(nginx).toContain("client_body_buffer_size 16k;");
  expect(nginx).toContain("listen 443 ssl;");
  expect(nginx).toContain(
    "ssl_certificate_key /etc/letsencrypt/live/ii-tonya.ru/privkey.pem;",
  );
  expect(nginx).toContain(
    "log_format ii_tonya_minimal '$ii_tonya_safe_method $status $request_time';",
  );
  expect(nginx.match(/error_log \/dev\/null;/gu)).toHaveLength(2);
});
