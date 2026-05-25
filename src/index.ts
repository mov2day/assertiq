export { analyzeProject } from "./analyze.js";
export { renderBadge } from "./reporters/badge.js";
export { buildHistoryEntry, computeScoreDelta, readHistory, writeHistory } from "./history.js";
export { renderHtmlReport } from "./reporters/html.js";
export { renderMarkdownComment } from "./reporters/markdown.js";
export { renderTerminalReport } from "./reporters/terminal.js";
export { failsThreshold, gradeForScore, issueFingerprint } from "./scoring.js";
export type {
  AnalyzeOptions,
  AssertIQReport,
  DimensionDelta,
  DimensionId,
  DimensionScore,
  FileAnalysis,
  Framework,
  HistoryEntry,
  Issue,
  IsolationSignal,
  ReportSummary,
  ScoreDelta,
  Severity,
  TestCaseInfo
} from "./types.js";
