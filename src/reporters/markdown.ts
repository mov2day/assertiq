import type { AssertIQReport, Issue } from "../types.js";

export const COMMENT_MARKER = "<!-- assertiq-comment -->";

export function renderMarkdownComment(report: AssertIQReport, newIssues: Issue[]): string {
  const lines = [
    COMMENT_MARKER,
    "## AssertIQ Test Intelligence",
    "",
    `**Overall:** ${report.summary.grade} (${report.summary.score}/100)`,
    "",
    "| Dimension | Grade | Score | Risks |",
    "|---|---:|---:|---:|",
    ...report.dimensions.map(
      (dimension) => `| ${dimension.name} | ${dimension.grade} | ${dimension.score} | ${dimension.issueCount} |`
    ),
    "",
    `**New risks introduced:** ${newIssues.length}`,
  ];

  if (newIssues.length > 0) {
    lines.push("", "| Risk | Location |", "|---|---|");
    for (const issue of newIssues.slice(0, 10)) {
      lines.push(`| ${escapeMarkdown(issue.message)} | \`${issue.file}:${issue.line}\` |`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", "<details><summary>Warnings</summary>", "", "```text", ...report.warnings, "```", "</details>");
  }

  return `${lines.join("\n")}\n`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, "\\|");
}
