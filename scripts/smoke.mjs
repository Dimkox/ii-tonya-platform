import process from "node:process";

const prefix = "--base-url=";
const baseUrlArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith(prefix));
if (baseUrlArgument === undefined) {
  process.stderr.write(
    "Usage: pnpm smoke -- --base-url=http://localhost:3000\n",
  );
  process.exitCode = 2;
} else {
  const baseUrl = new URL(baseUrlArgument.slice(prefix.length));
  if (!new Set(["http:", "https:"]).has(baseUrl.protocol)) {
    throw new Error("Smoke base URL must use http or https");
  }
  baseUrl.username = "";
  baseUrl.password = "";

  const deadline = Date.now() + 30_000;
  let lastFailure = "no response";
  while (Date.now() < deadline) {
    try {
      const live = await fetch(new URL("/health/live", baseUrl), {
        signal: AbortSignal.timeout(3_000),
      });
      const ready = await fetch(new URL("/health/ready", baseUrl), {
        signal: AbortSignal.timeout(3_000),
      });
      if (live.ok && ready.ok) {
        const liveBody = await live.json();
        const readyBody = await ready.json();
        if (liveBody.status === "live" && readyBody.status === "ready") {
          process.stdout.write("Smoke PASS: live and ready\n");
          lastFailure = "";
          break;
        }
      }
      lastFailure = `live=${live.status} ready=${ready.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (lastFailure !== "") {
    throw new Error(`Smoke failed: ${lastFailure}`);
  }
}
