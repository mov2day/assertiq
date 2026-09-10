import fs from "node:fs";
import { issueFingerprint } from "./scoring.js";
import type { AssertIQReport, Issue } from "./types.js";

export function diffIssues(baseReport: AssertIQReport, headReport: AssertIQReport): Issue[] {
  const base = new Set(baseReport.issues.map(issueFingerprint));
  return headReport.issues.filter((issue) => !base.has(issueFingerprint(issue)));
}

export function splitActionInput(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getActionInput(name: string): string {
  return process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`]?.trim() ?? "";
}

export function setActionOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `${name}<<ASSERTIQ\n${value}\nASSERTIQ\n`, "utf8");
    return;
  }
  process.stdout.write(`${name}=${value}\n`);
}

export function actionWarning(message: string): void {
  process.stdout.write(`::warning::${escapeActionCommand(message)}\n`);
}

export function actionErrorAnnotation(file: string, line: number, column: number, message: string): void {
  const properties = `file=${escapeActionProperty(file)},line=${Math.max(1, line)},col=${Math.max(1, column || 1)}`;
  process.stderr.write(`::error ${properties}::${escapeActionCommand(message)}\n`);
}

export function selectNewHighAnnotations(issues: Issue[], limit = 50): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (issue.severity !== "high") return false;
    const fingerprint = issueFingerprint(issue);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  }).slice(0, limit);
}

export function setActionFailed(message: string): void {
  process.stderr.write(`::error::${escapeActionCommand(message)}\n`);
  process.exitCode = 1;
}

export function escapeActionCommand(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeActionProperty(value: string): string { return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/:/g, "%3A").replace(/,/g, "%2C"); }

export function shouldWriteHistoryForAction(trackHistory: boolean, eventName: string, ref: string): boolean {
  if (!trackHistory) return false;
  return eventName === "push" && ref === "refs/heads/main";
}
