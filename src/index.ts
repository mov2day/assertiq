export { analyzeProject } from "./analyze.js";
export { renderBadge } from "./reporters/badge.js";
export { renderHtmlReport } from "./reporters/html.js";
export { renderMarkdownComment } from "./reporters/markdown.js";
export { renderTerminalReport } from "./reporters/terminal.js";
export { failsThreshold, gradeForScore, issueFingerprint } from "./scoring.js";
export type {
  AnalyzeOptions,
  AssertIQReport,
  DimensionId,
  DimensionScore,
  FileAnalysis,
  Framework,
  Issue,
  ReportSummary,
  Severity,
  TestCaseInfo
} from "./types.js";
