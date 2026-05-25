import type { AssertIQReport, Issue } from "../types.js";

export const COMMENT_MARKER = "<!-- assertiq-comment -->";

export function renderMarkdownComment(report: AssertIQReport, newIssues: Issue[]): string {
  const overallDelta = report.scoreDelta?.overall;
  const overallMovement =
    overallDelta === undefined
      ? `${report.summary.score}/100`
      : `${report.summary.score - overallDelta} → ${report.summary.score} (${formatDelta(overallDelta)})`;
  const lines = [
    COMMENT_MARKER,
    "## AssertIQ Test Intelligence",
    "",
    `**Overall:** ${report.summary.grade} (${overallMovement})`,
    "",
    "| Dimension | Grade | Score | Δ | Risks |",
    "|---|---:|---:|---:|---:|",
    ...report.dimensions.map(
      (dimension) =>
        `| ${dimension.name} | ${dimension.grade} | ${dimension.score} | ${formatDimensionDelta(report, dimension.id)} | ${dimension.issueCount} |`
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

function formatDimensionDelta(report: AssertIQReport, dimensionId: AssertIQReport["dimensions"][number]["id"]): string {
  const delta = report.scoreDelta?.dimensions.find((item) => item.id === dimensionId);
  if (!delta) return "—";
  return formatDelta(delta.value);
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}
