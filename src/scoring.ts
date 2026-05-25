import { createHash } from "node:crypto";
import { DIMENSIONS, GRADE_FLOORS } from "./constants.js";
import type { DimensionId, DimensionScore, Issue, Severity } from "./types.js";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 3,
  medium: 6,
  high: 10
};

export function gradeForScore(score: number): string {
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  if (rounded >= 90) return modifierGrade("A", rounded, 90, 100);
  if (rounded >= 75) return modifierGrade("B", rounded, 75, 89);
  if (rounded >= 60) return modifierGrade("C", rounded, 60, 74);
  if (rounded >= 45) return modifierGrade("D", rounded, 45, 59);
  return "F";
}

export function failsThreshold(score: number, threshold?: string): boolean {
  if (!threshold) return false;
  const normalized = threshold.toUpperCase();
  if (!isThreshold(normalized)) {
    throw new Error(`Invalid threshold "${threshold}". Use A, B, C, D, or F.`);
  }
  return score < GRADE_FLOORS[normalized];
}

export function scoreDimensions(issues: Issue[], testCount: number): DimensionScore[] {
  return DIMENSIONS.map((dimension) => {
    const dimensionIssues = issues.filter((issue) => issue.dimension === dimension.id);
    const score = testCount === 0 ? 0 : scoreDimension(dimension.id, dimensionIssues, testCount);
    return {
      ...dimension,
      score,
      grade: gradeForScore(score),
      issueCount: dimensionIssues.length
    };
  });
}

export function overallScore(dimensions: DimensionScore[]): number {
  const total = dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0);
  return Math.round(total);
}

export function stableIssueId(issue: Omit<Issue, "id">): string {
  return createHash("sha1")
    .update(`${issue.ruleId}|${issue.file}|${issue.line}|${issue.testName ?? ""}|${issue.evidence}`)
    .digest("hex")
    .slice(0, 12);
}

export function issueFingerprint(issue: Issue): string {
  return [
    issue.ruleId,
    issue.dimension,
    issue.file,
    issue.testName ?? "",
    issue.message,
    issue.evidence
  ].join("|");
}

function scoreDimension(_dimension: DimensionId, issues: Issue[], testCount: number): number {
  const penalty = issues.reduce((sum, issue) => sum + SEVERITY_WEIGHT[issue.severity], 0);
  const denominator = Math.max(3, testCount);
  return Math.max(0, Math.round(100 - (penalty / denominator) * 10));
}

function modifierGrade(base: "A" | "B" | "C" | "D", score: number, low: number, high: number): string {
  if (score <= low + 2) return `${base}-`;
  if (score >= high - 2) return `${base}+`;
  return base;
}

function isThreshold(value: string): value is "A" | "B" | "C" | "D" | "F" {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F";
}
