import { defineConfig, type Options } from "tsup";

const shared: Options = {
  platform: "node",
  target: "node22",
  outDir: "dist",
  bundle: true,
  splitting: false,
  sourcemap: true
};

export default defineConfig([
  {
    ...shared,
    entry: {
      action: "src/action.ts"
    },
    format: ["cjs"],
    clean: true,
    noExternal: ["@actions/github", "@babel/parser", "@babel/traverse", "@babel/types", "fast-glob", "picocolors"],
    outExtension() {
      return {
        js: ".cjs"
      };
    }
  },
  {
    ...shared,
    entry: {
      cli: "src/cli.ts",
      index: "src/index.ts"
    },
    format: ["esm"],
    dts: {
      entry: "src/index.ts"
    }
  }
]);
