import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeProject } from "../src/analyze.js";
import { applyConfig } from "../src/config.js";
import { failsNewRiskGate, filterNewIssues } from "../src/new-risk.js";
import { renderDashboard } from "../src/reporters/dashboard.js";
import { renderSarif } from "../src/reporters/sarif.js";
import type { AssertIQReport, Issue } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("new-risk gate", () => {
  const issues = ( ["low", "medium", "high"] as const).map((severity, index) => ({
    id: String(index), ruleId: "rule", dimension: "dead-test-risk", severity,
    message: "risk", file: "a.test.ts", line: index + 1, column: 1, evidence: "e"
  })) satisfies Issue[];

  it("filters by minimum severity and max count", () => {
    expect(filterNewIssues(issues, "medium")).toHaveLength(2);
    expect(failsNewRiskGate(issues, "high")).toBe(true);
    expect(failsNewRiskGate(issues, "high", 1)).toBe(false);
    expect(failsNewRiskGate(issues)).toBe(false);
  });
});

describe("config and output reporters", () => {
  it("suppresses by rule and fingerprint and downgrades warnings", () => {
    const result = applyConfig(issuesFixture(), {
      rules: { "rule-warn": "warn", "rule-off": "off" },
      suppressions: [{ fingerprint: "rule-suppressed|dead-test-risk|a.test.ts||message|e" }]
    });
    expect(result.suppressed).toBe(2);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe("low");
  });

  it("adds remediation and rule counts to analysis", async () => {
    const root = await fixtureRoot();
    await fs.writeFile(path.join(root, "sample.test.ts"), `it("works", () => {})`, "utf8");
    const report = await analyzeProject({ root });
    expect(report.issues[0]?.remediation).toBeTruthy();
    expect(report.issues[0]?.remediation).toContain("assertion");
  });

  it("renders SARIF with locations, levels, fingerprints, and remediation", () => {
    const report = reportFixture();
    const sarif = JSON.parse(renderSarif(report)) as { version: string; runs: Array<{ results: Array<Record<string, unknown>> }> };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.results[0]).toMatchObject({ ruleId: "rule-warn", level: "error" });
    expect(sarif.runs[0]?.results[0]?.fingerprints).toBeTruthy();
  });

  it("renders a self-contained dashboard with trend and issue data", () => {
    const dashboard = renderDashboard(reportFixture());
    expect(dashboard).toContain("Score trend");
    expect(dashboard).toContain("Dimension trends");
    expect(dashboard).toContain("Rule-count trends");
    expect(dashboard).toContain("Latest risks");
    expect(dashboard).toContain("ruleCounts");
    expect(dashboard).not.toContain("innerHTML");
    expect(dashboard).toContain("textContent");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "assertiq-feature-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", devDependencies: { vitest: "^4" } }), "utf8");
  return root;
}

function issuesFixture(): Issue[] {
  return [
    { id: "1", ruleId: "rule-warn", dimension: "dead-test-risk", severity: "high", message: "message", file: "a.test.ts", line: 1, column: 1, evidence: "e" },
    { id: "2", ruleId: "rule-off", dimension: "dead-test-risk", severity: "low", message: "message", file: "a.test.ts", line: 2, column: 1, evidence: "e" },
    { id: "3", ruleId: "rule-suppressed", dimension: "dead-test-risk", severity: "low", message: "message", file: "a.test.ts", line: 3, column: 1, evidence: "e" }
  ];
}

function reportFixture(): AssertIQReport {
  return {
    tool: "assertiq", version: "0.1.3", project: "fixture", root: "/tmp/fixture",
    summary: { score: 80, grade: "B", testFiles: 1, tests: 2, issues: 1, frameworks: ["vitest"] },
    dimensions: [],
    issues: [{ ...issuesFixture()[0]!, remediation: "Fix the test." }],
    history: [{ sha: "abc", date: "2026-07-26", score: 78, grade: "C+", dimensions: [], ruleCounts: { rule: 2 } }],
    warnings: []
  };
}
