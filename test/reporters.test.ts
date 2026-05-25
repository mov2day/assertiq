import { describe, expect, it } from "vitest";
import { renderHtmlReport } from "../src/reporters/html.js";
import { renderMarkdownComment } from "../src/reporters/markdown.js";
import { renderTerminalReport } from "../src/reporters/terminal.js";
import type { AssertIQReport } from "../src/types.js";

describe("reporters", () => {
  it("renders delta indicators in terminal output", () => {
    const report = reportFixture();
    const output = renderTerminalReport(report);
    expect(output).toContain("OVERALL");
    expect(output).toContain("↑ +4");
  });

  it("renders markdown delta column and score movement", () => {
    const report = reportFixture();
    const markdown = renderMarkdownComment(report, []);
    expect(markdown).toContain("| Dimension | Grade | Score | Δ | Risks |");
    expect(markdown).toContain("76 → 80 (+4)");
  });

  it("renders html sparkline and visible score delta", () => {
    const report = reportFixture();
    const html = renderHtmlReport(report);
    expect(html).toContain('class="spark"');
    expect(html).toContain("↑ +4");
  });
});

function reportFixture(): AssertIQReport {
  return {
    tool: "assertiq",
    version: "0.2.0",
    project: "fixture",
    root: "/tmp/fixture",
    summary: {
      score: 80,
      grade: "B+",
      testFiles: 1,
      tests: 3,
      issues: 1,
      frameworks: ["vitest"]
    },
    dimensions: [
      { id: "assertion-quality", name: "Assertion Quality", weight: 0.28, score: 81, grade: "B+", issueCount: 0 },
      { id: "flakiness-risk", name: "Flakiness Risk", weight: 0.23, score: 79, grade: "B", issueCount: 0 },
      { id: "isolation-risk", name: "Isolation Risk", weight: 0.1, score: 75, grade: "B-", issueCount: 1 },
      { id: "naming-clarity", name: "Naming Clarity", weight: 0.13, score: 80, grade: "B", issueCount: 0 },
      { id: "coverage-balance", name: "Coverage Balance", weight: 0.18, score: 82, grade: "B+", issueCount: 0 },
      { id: "dead-test-risk", name: "Dead Test Risk", weight: 0.08, score: 83, grade: "B+", issueCount: 0 }
    ],
    issues: [
      {
        id: "abc",
        ruleId: "isolation-spy-no-restore",
        dimension: "isolation-risk",
        severity: "high",
        message: "spy not restored",
        file: "a.test.ts",
        line: 3,
        column: 1,
        evidence: "spyOn"
      }
    ],
    history: [
      {
        sha: "old",
        date: "2026-05-24T00:00:00.000Z",
        score: 76,
        grade: "C+",
        dimensions: [
          { id: "assertion-quality", score: 76, grade: "C+" },
          { id: "flakiness-risk", score: 76, grade: "C+" },
          { id: "isolation-risk", score: 76, grade: "C+" },
          { id: "naming-clarity", score: 76, grade: "C+" },
          { id: "coverage-balance", score: 76, grade: "C+" },
          { id: "dead-test-risk", score: 76, grade: "C+" }
        ]
      }
    ],
    scoreDelta: {
      overall: 4,
      dimensions: [
        { id: "assertion-quality", value: 5 },
        { id: "flakiness-risk", value: 3 },
        { id: "isolation-risk", value: -1 },
        { id: "naming-clarity", value: 4 },
        { id: "coverage-balance", value: 6 },
        { id: "dead-test-risk", value: 7 }
      ]
    },
    warnings: []
  };
}
