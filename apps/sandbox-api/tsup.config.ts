import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  dts: true,
  clean: true,
  tsconfig: "../../tsconfig.base.json",
  noExternal: [/^@ii-tonya\//u],
  external: [/^(?!\.{1,2}\/)(?!@ii-tonya\/)(?![A-Za-z]:[\\/])[@A-Za-z]/u],
});
