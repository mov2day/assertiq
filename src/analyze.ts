import path from "node:path";
import { TOOL_VERSION } from "./constants.js";
import { computeScoreDelta, readHistory } from "./history.js";
import { readConfig } from "./config.js";
import { analyzeFile } from "./parser.js";
import { runRulesWithStats } from "./rules.js";
import { scanProject } from "./scanner.js";
import { gradeForScore, overallScore, scoreDimensions } from "./scoring.js";
import type { AnalyzeOptions, AssertIQReport, Framework } from "./types.js";

export async function analyzeProject(options: AnalyzeOptions = {}): Promise<AssertIQReport> {
  const root = path.resolve(options.root ?? ".");
  const loadedConfig = await readConfig(root);
  const scan = await scanProject(root, options.ignore ?? []);
  const files = await Promise.all(scan.files.map((file) => analyzeFile(root, file, scan.frameworks)));
  const ruleResult = runRulesWithStats(files, loadedConfig.config);
  const issues = ruleResult.issues;
  const history = await readHistory(root);
  const warnings = [...scan.warnings, ...files.flatMap((file) => file.warnings), ...history.warnings, ...loadedConfig.warnings];
  if (ruleResult.suppressed > 0) warnings.push(`${ruleResult.suppressed} issue(s) suppressed by assertiq.config.json.`);
  const testCount = files.reduce((sum, file) => sum + file.testCount, 0);
  const frameworks = uniqueFrameworks([
    ...scan.frameworks,
    ...files.map((file) => file.framework)
  ]);

  if (scan.files.length === 0) warnings.push("No test files found.");
  if (testCount === 0) warnings.push("No tests detected.");

  const dimensions = scoreDimensions(issues, testCount);
  const score = testCount === 0 ? 0 : overallScore(dimensions);
  const report: AssertIQReport = {
    tool: "assertiq",
    version: TOOL_VERSION,
    project: scan.projectName,
    root,
    summary: {
      score,
      grade: gradeForScore(score),
      testFiles: scan.files.length,
      tests: testCount,
      issues: issues.length,
      frameworks,
    },
    dimensions,
    issues,
    history: history.entries,
    warnings
  };
  const scoreDelta = computeScoreDelta(history.entries.at(-1), report);
  if (scoreDelta) report.scoreDelta = scoreDelta;

  return report;
}

function uniqueFrameworks(frameworks: Framework[]): Framework[] {
  const clean = frameworks.filter((framework) => framework !== "unknown");
  return [...new Set(clean)].sort();
}
