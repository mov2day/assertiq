import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    action: "src/action.ts",
    cli: "src/cli.ts",
    index: "src/index.ts"
  },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  bundle: true,
  splitting: false,
  sourcemap: true,
  dts: {
    entry: "src/index.ts"
  }
});
