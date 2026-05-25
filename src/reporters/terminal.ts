import pc from "picocolors";
import type { AssertIQReport, DimensionScore, Issue } from "../types.js";

export function renderTerminalReport(report: AssertIQReport): string {
  const lines = [
    pc.cyan("ASSERTIQ TEST INTELLIGENCE"),
    `${report.project} - ${report.summary.testFiles} test file(s) - ${report.summary.tests} test(s)`,
    "",
    ...report.dimensions.map(renderDimension),
    "",
    `OVERALL ${bar(report.summary.score)} ${colorGrade(report.summary.grade)} ${report.summary.score}`,
  ];

  if (report.issues.length > 0) {
    lines.push("", pc.yellow("Top risks:"));
    for (const issue of topIssues(report.issues)) {
      lines.push(`  - ${issue.message} [${issue.ruleId}]`);
      lines.push(`    ${issue.file}:${issue.line}${issue.testName ? ` - ${issue.testName}` : ""}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", pc.yellow("Warnings:"));
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }

  lines.push("", "HTML:   npx @mov2day/assertiq --html", "Badge:  npx @mov2day/assertiq --badge");
  return `${lines.join("\n")}\n`;
}

function renderDimension(dimension: DimensionScore): string {
  return `${dimension.name.padEnd(18)} ${bar(dimension.score)} ${colorGrade(dimension.grade).padEnd(10)} ${String(
    dimension.score
  ).padStart(3)}  ${dimension.issueCount} risk(s)`;
}

function bar(score: number): string {
  const filled = Math.round(score / 10);
  return `[${"#".repeat(filled)}${".".repeat(10 - filled)}]`;
}

function colorGrade(grade: string): string {
  const base = grade[0];
  if (base === "A" || base === "B") return pc.green(grade);
  if (base === "C") return pc.yellow(grade);
  return pc.red(grade);
}

function topIssues(issues: Issue[]): Issue[] {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 5);
}
