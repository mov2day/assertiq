#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { analyzeProject } from "./analyze.js";
import { renderBadge } from "./reporters/badge.js";
import { renderHtmlReport } from "./reporters/html.js";
import { renderTerminalReport } from "./reporters/terminal.js";
import { renderSarif } from "./reporters/sarif.js";
import { renderDashboard } from "./reporters/dashboard.js";
import { failsNewRiskGate, parseNonNegativeInteger, parseSeverity } from "./new-risk.js";
import type { Severity } from "./types.js";
import { diffIssues } from "./action-utils.js";
import { failsThreshold } from "./scoring.js";

interface CliOptions {
  dir: string;
  ignore?: string[];
  html?: boolean;
  badge?: boolean;
  json?: boolean;
  failBelow?: string;
  failOnNew?: Severity;
  maxNewIssues?: number;
  sarif?: boolean;
  sarifOutput?: string;
  dashboard?: boolean;
  dashboardOutput?: string;
  baseline?: string;
}

const program = new Command()
  .name("assertiq")
  .description("Static test intelligence and report cards for JavaScript and TypeScript test suites.")
  .option("--dir <path>", "path to scan", ".")
  .option("--ignore <glob>", "glob pattern to exclude; repeatable", collect, [])
  .option("--html", "write assertiq-report.html")
  .option("--badge", "write assertiq-badge.svg")
  .option("--json", "print JSON report")
  .option("--fail-below <grade>", "exit 1 if overall grade is below A, B, C, D, or F", parseThreshold)
  .option("--fail-on-new <severity>", "fail on issues at or above low, medium, or high", parseSeverity)
  .option("--max-new-issues <count>", "fail when issues exceed count", parseNonNegativeInteger)
  .option("--sarif", "write assertiq-results.sarif")
  .option("--sarif-output <path>", "SARIF output path", "assertiq-results.sarif")
  .option("--dashboard", "write assertiq-dashboard.html")
  .option("--dashboard-output <path>", "dashboard output path", "assertiq-dashboard.html")
  .option("--baseline <path>", "previous AssertIQ JSON report used by new-risk gates")
  .version("0.2.0");

program.parse(process.argv);

const options = program.opts<CliOptions>();

try {
  const root = path.resolve(options.dir);
  const report = await analyzeProject({ root, ignore: options.ignore ?? [] });

  if (options.html) {
    await fs.writeFile(path.join(root, "assertiq-report.html"), renderHtmlReport(report), "utf8");
  }
  if (options.badge) {
    await fs.writeFile(path.join(root, "assertiq-badge.svg"), renderBadge(report), "utf8");
  }
  if (options.sarif) await fs.writeFile(path.resolve(root, options.sarifOutput ?? "assertiq-results.sarif"), renderSarif(report), "utf8");
  if (options.dashboard) await fs.writeFile(path.resolve(root, options.dashboardOutput ?? "assertiq-dashboard.html"), renderDashboard(report), "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderTerminalReport(report));
  }

  if (failsThreshold(report.summary.score, options.failBelow)) {
    process.exitCode = 1;
  }
  if (options.failOnNew || options.maxNewIssues !== undefined) {
    if (!options.baseline) throw new Error("--fail-on-new and --max-new-issues require --baseline <AssertIQ JSON report>.");
    const baseline = await readBaseline(path.resolve(root, options.baseline));
    if (failsNewRiskGate(diffIssues(baseline, report), options.failOnNew, options.maxNewIssues)) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`AssertIQ error: ${(error as Error).message}\n`);
  process.exitCode = 1;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseThreshold(value: string): string {
  const normalized = value.toUpperCase();
  if (!/^(A|B|C|D|F)$/.test(normalized)) {
    throw new InvalidArgumentError("Use A, B, C, D, or F.");
  }
  return normalized;
}

async function readBaseline(filePath: string): Promise<import("./types.js").AssertIQReport> {
  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { issues?: unknown }).issues)) {
    throw new Error(`Baseline ${filePath} is not an AssertIQ JSON report.`);
  }
  return parsed as import("./types.js").AssertIQReport;
}
