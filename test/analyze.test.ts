import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeProject } from "../src/analyze.js";
import { renderBadge } from "../src/reporters/badge.js";
import { renderHtmlReport } from "../src/reporters/html.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "assertiq-test-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", devDependencies: { vitest: "^4.0.0" } }),
    "utf8"
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("analyzeProject", () => {
  it("detects common JS/TS test smells without executing tests", async () => {
    await fs.writeFile(
      path.join(root, "example.test.ts"),
      `
import { describe, it, expect } from "vitest";

describe("service", () => {
  it("test1", () => {
    setTimeout(() => {}, 500);
  });

  it.skip("handles invalid input", () => {
    expect(true).toBe(true);
  });

  it("returns result", () => {
    expect({ id: 1 }).toHaveProperty("id");
  });
});
// it("old test", () => {})
`,
      "utf8"
    );

    const report = await analyzeProject({ root });

    expect(report.tool).toBe("assertiq");
    expect(report.summary.testFiles).toBe(1);
    expect(report.summary.tests).toBe(3);
    expect(report.summary.frameworks).toEqual(["vitest"]);
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "assertion-zero",
        "flaky-hardcoded-wait",
        "naming-vague",
        "dead-skipped-test",
        "dead-commented-test",
        "assertion-structure-only"
      ])
    );
  });

  it("respects ignore globs", async () => {
    await fs.mkdir(path.join(root, "ignored"));
    await fs.writeFile(path.join(root, "ignored", "bad.test.ts"), `it("test1", () => {})`, "utf8");
    const report = await analyzeProject({ root, ignore: ["ignored/**"] });
    expect(report.summary.testFiles).toBe(0);
    expect(report.summary.grade).toBe("F");
  });

  it("renders escaped standalone reports", async () => {
    await fs.writeFile(
      path.join(root, "x.test.ts"),
      `it("escapes <tag>", () => { expect("<x>").toBe("<x>"); })`,
      "utf8"
    );
    const report = await analyzeProject({ root });
    const html = renderHtmlReport(report);
    const badge = renderBadge(report);

    expect(html).toContain("#a78bfa");
    expect(html).toContain("escapes &lt;tag&gt;");
    expect(html).not.toContain("fonts.googleapis");
    expect(badge).toContain("assertiq");
    expect(badge).toContain("<svg");
  });
});
