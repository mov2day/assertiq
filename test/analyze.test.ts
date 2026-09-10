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

  it("loads history and computes score deltas", async () => {
    await fs.writeFile(
      path.join(root, "x.test.ts"),
      `it("handles invalid input", () => { expect(1).toBe(1); })`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "assertiq-history.json"),
      JSON.stringify([
        {
          sha: "prev",
          date: "2026-05-24T00:00:00.000Z",
          score: 68,
          grade: "C",
          dimensions: [
            { id: "assertion-quality", score: 70, grade: "C" },
            { id: "flakiness-risk", score: 70, grade: "C" },
            { id: "isolation-risk", score: 70, grade: "C" },
            { id: "naming-clarity", score: 70, grade: "C" },
            { id: "coverage-balance", score: 70, grade: "C" },
            { id: "dead-test-risk", score: 70, grade: "C" }
          ]
        }
      ]),
      "utf8"
    );
    const report = await analyzeProject({ root });
    expect(report.history).toHaveLength(1);
    expect(report.scoreDelta?.overall).toBe(report.summary.score - 68);
  });

  it("flags isolation risk rules from AST signals", async () => {
    await fs.writeFile(
      path.join(root, "isolation.test.ts"),
      `
import { describe, it, expect, beforeAll } from "vitest";

describe("stateful suite", () => {
  let shared = 0;

  beforeAll(() => {
    global.foo = "boot";
  });

  it("mutates shared state", () => {
    shared += 1;
    const spy = jest.spyOn(Math, "random");
    process.env.RUN_MODE = "test";
    jest.mock("./dep");
    expect(shared).toBe(1);
  });
});
`,
      "utf8"
    );

    const report = await analyzeProject({ root });
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(
      expect.arrayContaining([
        "isolation-mutable-describe-var",
        "isolation-beforeall-no-afterall",
        "isolation-spy-no-restore",
        "isolation-global-mutation",
        "isolation-module-state"
      ])
    );
  });

  it("analyzes pytest tests alongside JavaScript without a Python runtime", async () => {
    await fs.writeFile(
      path.join(root, "test_service.py"),
      `
import pytest
import random
import time
from unittest import mock

shared = 0

@pytest.fixture
def patched_service():
    return mock.patch("service.client")

class TestService:
    @pytest.mark.parametrize("value", [1, 2])
    def test_returns_value(self, value):
        assert isinstance(value, int)

    @pytest.mark.skip(reason="pending")
    def test_later(self):
        assert True

    def test_uses_shared_state(self):
        global shared
        shared += 1
        time.sleep(1)
        random.random()
        assert False

# def test_old(): pass
`,
      "utf8"
    );
    await fs.writeFile(path.join(root, "example.test.ts"), `it("returns value", () => { expect(1).toBe(1); })`, "utf8");

    const report = await analyzeProject({ root });

    expect(report.summary.frameworks).toEqual(expect.arrayContaining(["pytest", "vitest"]));
    expect(report.summary.tests).toBe(4);
    expect(report.issues.map((issue) => issue.ruleId)).toEqual(expect.arrayContaining([
      "assertion-structure-only", "dead-skipped-test", "flaky-hardcoded-wait",
      "flaky-random-dependent", "isolation-python-shared-state",
      "isolation-pytest-fixture-no-teardown", "dead-commented-test"
    ]));
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
