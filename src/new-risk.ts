import type { Issue, Severity } from "./types.js";

const RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function filterNewIssues(issues: Issue[], minimum?: Severity): Issue[] {
  if (!minimum) return issues;
  return issues.filter((issue) => RANK[issue.severity] >= RANK[minimum]);
}

export function failsNewRiskGate(issues: Issue[], minimum?: Severity, maxIssues?: number): boolean {
  if (!minimum && maxIssues === undefined) return false;
  const relevant = filterNewIssues(issues, minimum);
  return maxIssues !== undefined ? relevant.length > maxIssues : relevant.length > 0;
}

export function parseSeverity(value: string): Severity {
  const normalized = value.toLowerCase();
  if (normalized !== "low" && normalized !== "medium" && normalized !== "high") {
    throw new Error('Use "low", "medium", or "high".');
  }
  return normalized;
}

export function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Use a non-negative integer.");
  return parsed;
}
