#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { analyzeProject } from "./analyze.js";
import { renderBadge } from "./reporters/badge.js";
import { renderHtmlReport } from "./reporters/html.js";
import { renderTerminalReport } from "./reporters/terminal.js";
import { failsThreshold } from "./scoring.js";

interface CliOptions {
  dir: string;
  ignore?: string[];
  html?: boolean;
  badge?: boolean;
  json?: boolean;
  failBelow?: string;
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

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderTerminalReport(report));
  }

  if (failsThreshold(report.summary.score, options.failBelow)) {
    process.exitCode = 1;
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
