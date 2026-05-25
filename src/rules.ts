import { stableIssueId } from "./scoring.js";
import type { DimensionId, FileAnalysis, Issue, Severity, TestCaseInfo } from "./types.js";

const VAGUE_NAME = /^(test\d*|testfoo|foo|bar|baz|works|should work|does stuff|stuff|happy path)$/i;
const BEHAVIOR_WORD =
  /\b(should|when|given|then|returns?|throws?|rejects?|resolves?|handles?|renders?|creates?|updates?|deletes?|allows?|prevents?|fails?|errors?|invalid|valid|empty|null|undefined|edge|timeout|retry|loads?|saves?|shows?|hides?)\b/i;
const NEGATIVE_OR_EDGE =
  /\b(error|errors|throw|throws|reject|rejects|fail|fails|invalid|empty|null|undefined|edge|boundary|missing|not found|timeout|denied|unauthorized|forbidden|malformed)\b/i;

export function runRules(files: FileAnalysis[]): Issue[] {
  const issues: Issue[] = [];
  for (const file of files) {
    for (const test of file.tests) {
      assertionQuality(test, issues);
      flakinessRisk(test, issues);
      namingClarity(test, issues);
      deadTestRisk(test, issues);
    }
    coverageBalance(file, issues);
    for (const skipped of file.skippedBlocks) {
      if (skipped.kind === "suite" || skipped.modifier === "only") {
        pushIssue(issues, {
          ruleId: skipped.modifier === "only" ? "dead-focused-block" : "dead-skipped-block",
          dimension: "dead-test-risk",
          severity: "high",
          message:
            skipped.modifier === "only"
              ? "Focused test block risks hiding the rest of the suite."
              : "Skipped block risks tests no longer running.",
          file: skipped.file,
          line: skipped.line,
          column: skipped.column,
          testName: skipped.name,
          evidence: `${skipped.kind}.${skipped.modifier}`
        });
      }
    }
    for (const commented of file.commentedOutTests) {
      pushIssue(issues, {
        ruleId: "dead-commented-test",
        dimension: "dead-test-risk",
        severity: "medium",
        message: "Commented-out test code risks dead or forgotten coverage.",
        file: commented.file,
        line: commented.line,
        column: 0,
        evidence: commented.evidence
      });
    }
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));
}

function assertionQuality(test: TestCaseInfo, issues: Issue[]) {
  if (test.skipped || test.todo) return;
  if (test.assertionCount === 0) {
    pushTestIssue(issues, test, {
      ruleId: "assertion-zero",
      dimension: "assertion-quality",
      severity: "high",
      message: "Test has no detected assertion, so it may pass without verifying behavior.",
      evidence: "0 assertions"
    });
    return;
  }
  if (test.assertionCount === 1 && test.weakAssertionCount === 1) {
    pushTestIssue(issues, test, {
      ruleId: "assertion-weak-single",
      dimension: "assertion-quality",
      severity: "medium",
      message: "Single generic assertion gives weak failure evidence.",
      evidence: "single weak assertion"
    });
  }
  if (test.snapshotAssertionCount > 0 && test.snapshotAssertionCount === test.assertionCount) {
    pushTestIssue(issues, test, {
      ruleId: "assertion-snapshot-only",
      dimension: "assertion-quality",
      severity: "medium",
      message: "Snapshot-only test can hide behavior drift behind broad fixture updates.",
      evidence: "snapshot-only assertions"
    });
  }
  if (test.structureAssertionCount > 0 && test.structureAssertionCount === test.assertionCount) {
    pushTestIssue(issues, test, {
      ruleId: "assertion-structure-only",
      dimension: "assertion-quality",
      severity: "medium",
      message: "Structure-only assertion checks shape more than behavior or values.",
      evidence: "structure-only assertions"
    });
  }
}

function flakinessRisk(test: TestCaseInfo, issues: Issue[]) {
  if (test.hardcodedWaitCount > 0) {
    pushTestIssue(issues, test, {
      ruleId: "flaky-hardcoded-wait",
      dimension: "flakiness-risk",
      severity: "high",
      message: "Hardcoded wait creates timing-dependent test risk.",
      evidence: `${test.hardcodedWaitCount} hardcoded wait call(s)`
    });
  }
  if (test.timeDependentCount > 0) {
    pushTestIssue(issues, test, {
      ruleId: "flaky-time-dependent",
      dimension: "flakiness-risk",
      severity: "medium",
      message: "Wall-clock time usage can make assertions environment-dependent.",
      evidence: `${test.timeDependentCount} time-dependent call(s)`
    });
  }
  if (test.randomCount > 0) {
    pushTestIssue(issues, test, {
      ruleId: "flaky-random-dependent",
      dimension: "flakiness-risk",
      severity: "medium",
      message: "Random data can make failures hard to reproduce.",
      evidence: `${test.randomCount} random call(s)`
    });
  }
  if (test.externalHttpCount > 0 && test.framework !== "cypress" && test.framework !== "playwright") {
    pushTestIssue(issues, test, {
      ruleId: "flaky-external-http",
      dimension: "flakiness-risk",
      severity: "medium",
      message: "External HTTP URL in a test can couple results to network state.",
      evidence: `${test.externalHttpCount} external URL(s)`
    });
  }
}

function namingClarity(test: TestCaseInfo, issues: Issue[]) {
  const normalized = test.name.trim();
  if (normalized === "(anonymous test)" || VAGUE_NAME.test(normalized) || normalized.length < 4) {
    pushTestIssue(issues, test, {
      ruleId: "naming-vague",
      dimension: "naming-clarity",
      severity: "medium",
      message: "Test name is vague and may not describe expected behavior.",
      evidence: normalized
    });
    return;
  }
  if (!BEHAVIOR_WORD.test(normalized)) {
    pushTestIssue(issues, test, {
      ruleId: "naming-no-behavior-signal",
      dimension: "naming-clarity",
      severity: "low",
      message: "Test name has weak behavior signal.",
      evidence: normalized
    });
  }
}

function coverageBalance(file: FileAnalysis, issues: Issue[]) {
  if (file.tests.length === 0) return;
  if (file.tests.length === 1) {
    const test = file.tests[0];
    if (test) {
      pushTestIssue(issues, test, {
        ruleId: "coverage-single-test-file",
        dimension: "coverage-balance",
        severity: "low",
        message: "Single-test file may leave behavior branches unrepresented.",
        evidence: "1 test in file"
      });
    }
  }
  const runnableTests = file.tests.filter((test) => !test.skipped && !test.todo);
  if (runnableTests.length >= 2 && !runnableTests.some((test) => NEGATIVE_OR_EDGE.test(test.fullName))) {
    const first = runnableTests[0];
    if (first) {
      pushTestIssue(issues, first, {
        ruleId: "coverage-happy-path-only",
        dimension: "coverage-balance",
        severity: "medium",
        message: "Suite appears happy-path-only; add error, edge, or invalid-state coverage.",
        evidence: `${runnableTests.length} runnable tests, no edge/error names`
      });
    }
  }
}

function deadTestRisk(test: TestCaseInfo, issues: Issue[]) {
  if (test.skipped || test.todo) {
    pushTestIssue(issues, test, {
      ruleId: "dead-skipped-test",
      dimension: "dead-test-risk",
      severity: "high",
      message: "Skipped or todo test does not protect current behavior.",
      evidence: test.todo ? "todo test" : "skipped test"
    });
  }
  if (test.only) {
    pushTestIssue(issues, test, {
      ruleId: "dead-focused-test",
      dimension: "dead-test-risk",
      severity: "high",
      message: "Focused test can accidentally suppress the rest of the suite.",
      evidence: "only modifier"
    });
  }
}

function pushTestIssue(
  issues: Issue[],
  test: TestCaseInfo,
  issue: {
    ruleId: string;
    dimension: DimensionId;
    severity: Severity;
    message: string;
    evidence: string;
  }
) {
  pushIssue(issues, {
    ...issue,
    file: test.file,
    line: test.line,
    column: test.column,
    testName: test.fullName,
    evidence: issue.evidence
  });
}

function pushIssue(issues: Issue[], issue: Omit<Issue, "id">) {
  issues.push({
    ...issue,
    id: stableIssueId(issue)
  });
}
