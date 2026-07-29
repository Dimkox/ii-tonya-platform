import { spawnSync } from "node:child_process";

const safeCmdToken = /^[-A-Za-z0-9_@./:=,*]+$/;

export function runPnpm(args, options = {}) {
  if (!Array.isArray(args) || args.some((arg) => !safeCmdToken.test(arg))) {
    throw new Error("pnpm launcher accepts only fixed, shell-safe argument tokens");
  }
  const child = process.platform === "win32"
    ? {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", ["pnpm", ...args].join(" ")],
      }
    : { file: "pnpm", args };
  const result = spawnSync(child.file, child.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: options.encoding,
    stdio: options.stdio ?? "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} exited with ${String(result.status)}`);
  }
  return result;
}
