import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "assertiq-cli-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "cli-fixture", devDependencies: { jest: "^30.0.0" } }),
    "utf8"
  );
  await fs.writeFile(path.join(root, "sample.test.js"), `test("works", () => {})`, "utf8");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("cli", () => {
  it("prints JSON and writes HTML and badge", async () => {
    const { stdout } = await execFileAsync("node", [
      "dist/cli.js",
      "--dir",
      root,
      "--json",
      "--html",
      "--badge"
    ]);
    const report = JSON.parse(stdout) as { tool: string; summary: { testFiles: number } };
    expect(report.tool).toBe("assertiq");
    expect(report.summary.testFiles).toBe(1);
    expect(await fs.readFile(path.join(root, "assertiq-report.html"), "utf8")).toContain("AssertIQ");
    expect(await fs.readFile(path.join(root, "assertiq-badge.svg"), "utf8")).toContain("assertiq");
  });

  it("uses fail-below exit code", async () => {
    await expect(
      execFileAsync("node", ["dist/cli.js", "--dir", root, "--fail-below", "A"])
    ).rejects.toMatchObject({ code: 1 });
  });
});
