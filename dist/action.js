// src/action.ts
import { execFileSync } from "child_process";
import fs4 from "fs";
import os from "os";
import path5 from "path";
import * as github from "@actions/github";

// src/analyze.ts
import path3 from "path";

// src/constants.ts
var TOOL_VERSION = "0.1.0";
var DIMENSIONS = [
  { id: "assertion-quality", name: "Assertion Quality", weight: 0.3 },
  { id: "flakiness-risk", name: "Flakiness Risk", weight: 0.25 },
  { id: "naming-clarity", name: "Naming Clarity", weight: 0.15 },
  { id: "coverage-balance", name: "Coverage Balance", weight: 0.2 },
  { id: "dead-test-risk", name: "Dead Test Risk", weight: 0.1 }
];
var DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/out/**",
  "**/playwright-report/**",
  "**/test-results/**"
];
var GRADE_FLOORS = {
  A: 90,
  B: 75,
  C: 60,
  D: 45,
  F: 0
};

// src/parser.ts
import fs2 from "fs/promises";
import path2 from "path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import * as t from "@babel/types";

// src/scanner.ts
import fs from "fs/promises";
import path from "path";
import fg from "fast-glob";
var TEST_GLOBS = [
  "**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/__tests__/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/test/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/tests/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/cypress/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/e2e/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"
];
async function scanProject(rootInput = ".", ignore = []) {
  const root = path.resolve(rootInput);
  const warnings = [];
  const project = await readProject(root, warnings);
  const files = await fg(TEST_GLOBS, {
    cwd: root,
    absolute: false,
    onlyFiles: true,
    unique: true,
    ignore: [...DEFAULT_IGNORE, ...ignore],
    dot: false
  });
  const normalizedFiles = files.map(toPosix).sort();
  const frameworkSet = new Set(project.frameworks);
  for (const file of normalizedFiles) {
    const fromPath = frameworkFromPath(file);
    if (fromPath !== "unknown") frameworkSet.add(fromPath);
  }
  return {
    root,
    files: normalizedFiles,
    frameworks: [...frameworkSet],
    projectName: project.name,
    warnings
  };
}
function frameworkFromPath(file) {
  const normalized = toPosix(file).toLowerCase();
  if (normalized.includes("/cypress/") || normalized.startsWith("cypress/")) return "cypress";
  if (normalized.includes("playwright") || normalized.includes("/e2e/")) return "playwright";
  return "unknown";
}
function toPosix(file) {
  return file.split(path.sep).join("/");
}
async function readProject(root, warnings) {
  const packagePath = path.join(root, "package.json");
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    const pkg = JSON.parse(raw);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };
    return {
      name: pkg.name ?? path.basename(root),
      frameworks: detectFrameworks(deps)
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      warnings.push(`Could not read package.json: ${error.message}`);
    }
    return { name: path.basename(root), frameworks: [] };
  }
}
function detectFrameworks(deps) {
  const frameworks = /* @__PURE__ */ new Set();
  if (deps.jest || deps["@jest/globals"]) frameworks.add("jest");
  if (deps.vitest) frameworks.add("vitest");
  if (deps["@playwright/test"]) frameworks.add("playwright");
  if (deps.cypress) frameworks.add("cypress");
  if (deps.mocha || deps.chai) frameworks.add("mocha");
  return [...frameworks];
}

// src/parser.ts
var TEST_BASES = /* @__PURE__ */ new Set(["it", "test", "specify"]);
var SUITE_BASES = /* @__PURE__ */ new Set(["describe", "context"]);
var WEAK_MATCHERS = /* @__PURE__ */ new Set([
  "assert",
  "ok",
  "toBeTruthy",
  "toBeFalsy",
  "toBeDefined",
  "toBeUndefined",
  "toBeNull",
  "toExist"
]);
var STRUCTURE_MATCHERS = /* @__PURE__ */ new Set([
  "toHaveProperty",
  "toContainKey",
  "toContainKeys",
  "toMatchObject",
  "objectContaining",
  "arrayContaining"
]);
var SNAPSHOT_MATCHERS = /* @__PURE__ */ new Set(["toMatchSnapshot", "toMatchInlineSnapshot", "toThrowErrorMatchingSnapshot"]);
var traverseAst = traverseModule.default ?? traverseModule;
async function analyzeFile(root, relativeFile, detectedFrameworks) {
  const absoluteFile = path2.join(root, relativeFile);
  const source = await fs2.readFile(absoluteFile, "utf8");
  const pathFramework = frameworkFromPath(relativeFile);
  const framework = pathFramework === "unknown" ? detectedFrameworks[0] ?? "unknown" : pathFramework;
  const commentedOutTests = findCommentedOutTests(source, relativeFile);
  const warnings = [];
  let ast;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: [
        "jsx",
        "typescript",
        "decorators-legacy",
        "classProperties",
        "classPrivateProperties",
        "dynamicImport",
        "importAttributes",
        "topLevelAwait"
      ]
    });
  } catch (error) {
    warnings.push(`${relativeFile}: parse failed: ${error.message}`);
    return {
      file: relativeFile,
      framework,
      testCount: 0,
      tests: [],
      skippedBlocks: [],
      commentedOutTests,
      warnings
    };
  }
  const parserErrors = ast.errors ?? [];
  for (const error of parserErrors) {
    warnings.push(`${relativeFile}: parser recovered: ${error.message}`);
  }
  const suiteStack = [];
  const tests = [];
  const skippedBlocks = [];
  traverseAst(ast, {
    CallExpression: {
      enter(callPath) {
        const call = getCalleeInfo(callPath.node);
        if (!call) return;
        const args = getCallableArgs(callPath.node, call.each);
        const name = literalName(args[0]);
        const location = locationOf(callPath.node);
        if (call.kind === "suite") {
          const suiteName = name || "(anonymous suite)";
          const skipped2 = call.skipped || suiteStack.some((suite) => suite.skipped);
          if (call.skipped || call.only || call.todo) {
            skippedBlocks.push({
              name: suiteName,
              file: relativeFile,
              line: location.line,
              column: location.column,
              kind: "suite",
              modifier: call.only ? "only" : call.todo ? "todo" : "skip"
            });
          }
          suiteStack.push({ name: suiteName, skipped: skipped2 });
          return;
        }
        const testName = name || "(anonymous test)";
        const skipped = call.skipped || suiteStack.some((suite) => suite.skipped);
        if (call.skipped || call.only || call.todo || skipped) {
          skippedBlocks.push({
            name: testName,
            file: relativeFile,
            line: location.line,
            column: location.column,
            kind: "test",
            modifier: call.only ? "only" : call.todo ? "todo" : "skip"
          });
        }
        tests.push(extractTest(callPath, args, testName, suiteStack, relativeFile, framework, skipped, call.only, call.todo));
      },
      exit(callPath) {
        const call = getCalleeInfo(callPath.node);
        if (call?.kind === "suite") suiteStack.pop();
      }
    }
  });
  return {
    file: relativeFile,
    framework,
    testCount: tests.length,
    tests,
    skippedBlocks,
    commentedOutTests,
    warnings
  };
}
function extractTest(callPath, args, name, suites, file, framework, skipped, only, todo) {
  const callbackIndex = args.findIndex((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  const callbackPath = callbackIndex >= 0 ? callPath.get(`arguments.${callbackIndex}`) : void 0;
  const metrics = {
    assertions: [],
    hardcodedWaitCount: 0,
    timeDependentCount: 0,
    randomCount: 0,
    externalHttpCount: 0
  };
  if (callbackPath && (callbackPath.isFunctionExpression() || callbackPath.isArrowFunctionExpression())) {
    callbackPath.traverse({
      CallExpression(innerPath) {
        const assertion = assertionInfo(innerPath.node);
        if (assertion) metrics.assertions.push({ ...assertion, line: locationOf(innerPath.node).line });
        if (isHardcodedWait(innerPath.node)) metrics.hardcodedWaitCount += 1;
        if (isDateNow(innerPath.node)) metrics.timeDependentCount += 1;
        if (isRandom(innerPath.node)) metrics.randomCount += 1;
      },
      NewExpression(innerPath) {
        if (t.isIdentifier(innerPath.node.callee, { name: "Date" })) metrics.timeDependentCount += 1;
      },
      StringLiteral(innerPath) {
        if (isExternalHttp(innerPath.node.value)) metrics.externalHttpCount += 1;
      }
    });
  }
  const location = locationOf(callPath.node);
  const fullName = [...suites.map((suite) => suite.name), name].join(" > ");
  return {
    name,
    fullName,
    file,
    line: location.line,
    column: location.column,
    framework,
    skipped,
    only,
    todo,
    assertionCount: metrics.assertions.length,
    weakAssertionCount: metrics.assertions.filter((assertion) => assertion.weak).length,
    structureAssertionCount: metrics.assertions.filter((assertion) => assertion.structureOnly).length,
    snapshotAssertionCount: metrics.assertions.filter((assertion) => assertion.snapshot).length,
    hardcodedWaitCount: metrics.hardcodedWaitCount,
    timeDependentCount: metrics.timeDependentCount,
    randomCount: metrics.randomCount,
    externalHttpCount: metrics.externalHttpCount
  };
}
function getCalleeInfo(node) {
  const callee = t.isCallExpression(node.callee) ? node.callee.callee : node.callee;
  const parts = memberParts(callee);
  const base = parts[0];
  if (!base) return void 0;
  const modifiers = new Set(parts.slice(1));
  const each = modifiers.has("each");
  if (base === "xit") return { kind: "test", skipped: true, only: false, todo: false, each };
  if (base === "xdescribe") return { kind: "suite", skipped: true, only: false, todo: false, each };
  if (TEST_BASES.has(base)) {
    return {
      kind: "test",
      skipped: modifiers.has("skip"),
      only: modifiers.has("only"),
      todo: modifiers.has("todo"),
      each
    };
  }
  if (SUITE_BASES.has(base)) {
    return {
      kind: "suite",
      skipped: modifiers.has("skip"),
      only: modifiers.has("only"),
      todo: modifiers.has("todo"),
      each
    };
  }
  return void 0;
}
function getCallableArgs(node, each) {
  if (each && t.isCallExpression(node.callee)) return node.arguments;
  return node.arguments;
}
function literalName(node) {
  if (!node) return void 0;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  }
  return void 0;
}
function assertionInfo(node) {
  const matcher = assertionMatcher(node);
  if (!matcher) return void 0;
  return {
    matcher,
    weak: WEAK_MATCHERS.has(matcher),
    structureOnly: STRUCTURE_MATCHERS.has(matcher),
    snapshot: SNAPSHOT_MATCHERS.has(matcher)
  };
}
function assertionMatcher(node) {
  const callee = node.callee;
  if (t.isIdentifier(callee) && (callee.name === "assert" || callee.name === "ok")) return callee.name;
  if (!t.isMemberExpression(callee)) return void 0;
  const property = propertyName(callee.property);
  if (!property) return void 0;
  const object = callee.object;
  if (t.isCallExpression(object) && isExpectCall(object)) return property;
  if (t.isMemberExpression(object) && chainContains(object, "resolves", "rejects", "not")) return property;
  const parts = memberParts(callee);
  if (parts[0] === "assert") return property;
  if (parts.includes("should")) return property;
  return void 0;
}
function isExpectCall(node) {
  return t.isIdentifier(node.callee, { name: "expect" });
}
function chainContains(node, ...names) {
  const parts = memberParts(node);
  if (!parts.some((part) => names.includes(part))) return false;
  return parts.includes("expect") || parts.includes("assert") || parts.includes("should");
}
function isHardcodedWait(node) {
  const parts = memberParts(node.callee);
  const callee = parts.join(".");
  const last = parts.at(-1);
  const waitish = last === "setTimeout" || last === "setInterval" || last === "sleep" || last === "delay" || last === "wait" || callee.endsWith(".waitForTimeout");
  return waitish && node.arguments.some((arg) => t.isNumericLiteral(arg) && arg.value > 0);
}
function isDateNow(node) {
  return memberParts(node.callee).join(".") === "Date.now";
}
function isRandom(node) {
  return memberParts(node.callee).join(".") === "Math.random";
}
function isExternalHttp(value) {
  return /^https?:\/\//i.test(value) && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(value);
}
function memberParts(node) {
  if (!node) return [];
  if (t.isIdentifier(node)) return [node.name];
  if (t.isSuper(node) || t.isThisExpression(node)) return [];
  if (t.isCallExpression(node)) return memberParts(node.callee);
  if (t.isMemberExpression(node)) {
    return [...memberParts(node.object), propertyName(node.property)].filter((part) => Boolean(part));
  }
  return [];
}
function propertyName(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return String(node.value);
  return void 0;
}
function locationOf(node) {
  return {
    line: node.loc?.start.line ?? 1,
    column: node.loc?.start.column ?? 0
  };
}
function findCommentedOutTests(source, file) {
  const results = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^\/\/\s*(it|test|describe|context|specify)\s*(\.skip|\.only|\.todo)?\s*\(/.test(trimmed)) {
      results.push({ file, line: index + 1, evidence: trimmed.slice(0, 140) });
    }
  });
  const blockPattern = /\/\*[\s\S]*?\*\//g;
  for (const match of source.matchAll(blockPattern)) {
    if (/\b(it|test|describe|context|specify)\s*(\.skip|\.only|\.todo)?\s*\(/.test(match[0])) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      results.push({ file, line, evidence: match[0].replace(/\s+/g, " ").slice(0, 140) });
    }
  }
  return results;
}

// src/scoring.ts
import { createHash } from "crypto";
var SEVERITY_WEIGHT = {
  low: 3,
  medium: 6,
  high: 10
};
function gradeForScore(score) {
  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  if (rounded >= 90) return modifierGrade("A", rounded, 90, 100);
  if (rounded >= 75) return modifierGrade("B", rounded, 75, 89);
  if (rounded >= 60) return modifierGrade("C", rounded, 60, 74);
  if (rounded >= 45) return modifierGrade("D", rounded, 45, 59);
  return "F";
}
function failsThreshold(score, threshold) {
  if (!threshold) return false;
  const normalized = threshold.toUpperCase();
  if (!isThreshold(normalized)) {
    throw new Error(`Invalid threshold "${threshold}". Use A, B, C, D, or F.`);
  }
  return score < GRADE_FLOORS[normalized];
}
function scoreDimensions(issues, testCount) {
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
function overallScore(dimensions) {
  const total = dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0);
  return Math.round(total);
}
function stableIssueId(issue) {
  return createHash("sha1").update(`${issue.ruleId}|${issue.file}|${issue.line}|${issue.testName ?? ""}|${issue.evidence}`).digest("hex").slice(0, 12);
}
function issueFingerprint(issue) {
  return [
    issue.ruleId,
    issue.dimension,
    issue.file,
    issue.testName ?? "",
    issue.message,
    issue.evidence
  ].join("|");
}
function scoreDimension(_dimension, issues, testCount) {
  const penalty = issues.reduce((sum, issue) => sum + SEVERITY_WEIGHT[issue.severity], 0);
  const denominator = Math.max(3, testCount);
  return Math.max(0, Math.round(100 - penalty / denominator * 10));
}
function modifierGrade(base, score, low, high) {
  if (score <= low + 2) return `${base}-`;
  if (score >= high - 2) return `${base}+`;
  return base;
}
function isThreshold(value) {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "F";
}

// src/rules.ts
var VAGUE_NAME = /^(test\d*|testfoo|foo|bar|baz|works|should work|does stuff|stuff|happy path)$/i;
var BEHAVIOR_WORD = /\b(should|when|given|then|returns?|throws?|rejects?|resolves?|handles?|renders?|creates?|updates?|deletes?|allows?|prevents?|fails?|errors?|invalid|valid|empty|null|undefined|edge|timeout|retry|loads?|saves?|shows?|hides?)\b/i;
var NEGATIVE_OR_EDGE = /\b(error|errors|throw|throws|reject|rejects|fail|fails|invalid|empty|null|undefined|edge|boundary|missing|not found|timeout|denied|unauthorized|forbidden|malformed)\b/i;
function runRules(files) {
  const issues = [];
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
          message: skipped.modifier === "only" ? "Focused test block risks hiding the rest of the suite." : "Skipped block risks tests no longer running.",
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
function assertionQuality(test, issues) {
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
function flakinessRisk(test, issues) {
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
function namingClarity(test, issues) {
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
function coverageBalance(file, issues) {
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
function deadTestRisk(test, issues) {
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
function pushTestIssue(issues, test, issue) {
  pushIssue(issues, {
    ...issue,
    file: test.file,
    line: test.line,
    column: test.column,
    testName: test.fullName,
    evidence: issue.evidence
  });
}
function pushIssue(issues, issue) {
  issues.push({
    ...issue,
    id: stableIssueId(issue)
  });
}

// src/analyze.ts
async function analyzeProject(options = {}) {
  const root = path3.resolve(options.root ?? ".");
  const scan = await scanProject(root, options.ignore ?? []);
  const files = await Promise.all(scan.files.map((file) => analyzeFile(root, file, scan.frameworks)));
  const issues = runRules(files);
  const warnings = [...scan.warnings, ...files.flatMap((file) => file.warnings)];
  const testCount = files.reduce((sum, file) => sum + file.testCount, 0);
  const frameworks = uniqueFrameworks([
    ...scan.frameworks,
    ...files.map((file) => file.framework)
  ]);
  if (scan.files.length === 0) warnings.push("No test files found.");
  if (testCount === 0) warnings.push("No tests detected.");
  const dimensions = scoreDimensions(issues, testCount);
  const score = testCount === 0 ? 0 : overallScore(dimensions);
  return {
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
      frameworks
    },
    dimensions,
    issues,
    warnings
  };
}
function uniqueFrameworks(frameworks) {
  const clean = frameworks.filter((framework) => framework !== "unknown");
  return [...new Set(clean)].sort();
}

// src/action-comments.ts
async function findStickyCommentId(api, context2, marker, perPage = 100) {
  let page = 1;
  while (true) {
    const response = await api.listComments({
      ...context2,
      per_page: perPage,
      page
    });
    const found = response.data.find((comment) => comment.body?.includes(marker));
    if (found) return found.id;
    if (response.data.length < perPage) return void 0;
    page += 1;
  }
}
async function upsertStickyComment(api, context2, marker, body) {
  const existingId = await findStickyCommentId(api, context2, marker);
  if (existingId) {
    await api.updateComment({
      owner: context2.owner,
      repo: context2.repo,
      comment_id: existingId,
      body
    });
    return "updated";
  }
  await api.createComment({
    ...context2,
    body
  });
  return "created";
}
async function safeUpsertStickyComment(api, context2, marker, body, onWarning) {
  try {
    await upsertStickyComment(api, context2, marker, body);
    return true;
  } catch (error) {
    onWarning(`Could not post AssertIQ PR comment: ${error.message}`);
    return false;
  }
}

// src/action-paths.ts
import path4 from "path";
function resolveActionPaths(dirInput, workspaceInput = process.env.GITHUB_WORKSPACE ?? process.cwd()) {
  const workspaceRoot = path4.resolve(workspaceInput);
  const headRoot = path4.resolve(workspaceRoot, dirInput || ".");
  const baseRelativeDir = isPathInside(workspaceRoot, headRoot) ? path4.relative(workspaceRoot, headRoot) || "." : null;
  return { workspaceRoot, headRoot, baseRelativeDir };
}
function resolveBaseScanRoot(baseWorktreeRoot, baseRelativeDir) {
  return path4.resolve(baseWorktreeRoot, baseRelativeDir);
}
function isPathInside(base, target) {
  const relative = path4.relative(base, target);
  return relative === "" || !relative.startsWith("..") && !path4.isAbsolute(relative);
}

// src/action-utils.ts
import fs3 from "fs";
function diffIssues(baseReport, headReport) {
  const base = new Set(baseReport.issues.map(issueFingerprint));
  return headReport.issues.filter((issue) => !base.has(issueFingerprint(issue)));
}
function splitActionInput(value) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}
function getActionInput(name) {
  return process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`]?.trim() ?? "";
}
function setActionOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs3.appendFileSync(outputPath, `${name}<<ASSERTIQ
${value}
ASSERTIQ
`, "utf8");
    return;
  }
  process.stdout.write(`${name}=${value}
`);
}
function actionWarning(message) {
  process.stdout.write(`::warning::${escapeActionCommand(message)}
`);
}
function setActionFailed(message) {
  process.stderr.write(`::error::${escapeActionCommand(message)}
`);
  process.exitCode = 1;
}
function escapeActionCommand(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

// src/reporters/markdown.ts
var COMMENT_MARKER = "<!-- assertiq-comment -->";
function renderMarkdownComment(report, newIssues) {
  const lines = [
    COMMENT_MARKER,
    "## AssertIQ Test Intelligence",
    "",
    `**Overall:** ${report.summary.grade} (${report.summary.score}/100)`,
    "",
    "| Dimension | Grade | Score | Risks |",
    "|---|---:|---:|---:|",
    ...report.dimensions.map(
      (dimension) => `| ${dimension.name} | ${dimension.grade} | ${dimension.score} | ${dimension.issueCount} |`
    ),
    "",
    `**New risks introduced:** ${newIssues.length}`
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
  return `${lines.join("\n")}
`;
}
function escapeMarkdown(value) {
  return value.replace(/\|/g, "\\|");
}

// src/action.ts
async function run() {
  const dirInput = getActionInput("dir") || ".";
  const ignore = splitActionInput(getActionInput("ignore"));
  const failBelow = getActionInput("fail-below") || void 0;
  const postComment = (getActionInput("post-comment") || "true").toLowerCase() !== "false";
  const token = getActionInput("github-token") || process.env.GITHUB_TOKEN || "";
  const paths = resolveActionPaths(dirInput);
  const headReport = await analyzeProject({ root: paths.headRoot, ignore });
  let newIssues = headReport.issues;
  if (github.context.payload.pull_request) {
    if (!paths.baseRelativeDir) {
      actionWarning(
        `Directory "${dirInput}" resolves outside GITHUB_WORKSPACE, so base-vs-head diff is disabled; reporting head-only risks.`
      );
    } else {
      const baseReport = await analyzeBase(paths.baseRelativeDir, ignore).catch((error) => {
        actionWarning(`Base analysis failed; reporting head-only risks. ${error.message}`);
        return void 0;
      });
      if (baseReport) newIssues = diffIssues(baseReport, headReport);
    }
  }
  setActionOutput("score", String(headReport.summary.score));
  setActionOutput("grade", headReport.summary.grade);
  setActionOutput("json", JSON.stringify(headReport));
  if (postComment && github.context.payload.pull_request) {
    await upsertComment(token, headReport, newIssues);
  }
  if (failsThreshold(headReport.summary.score, failBelow)) {
    setActionFailed(`AssertIQ grade ${headReport.summary.grade} (${headReport.summary.score}) is below ${failBelow}.`);
  }
}
async function analyzeBase(baseRelativeDir, ignore) {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest?.base?.sha) throw new Error("Missing pull request base SHA.");
  const baseSha = pullRequest.base.sha;
  const tempDir = fs4.mkdtempSync(path5.join(os.tmpdir(), "assertiq-base-"));
  try {
    execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", baseSha], { stdio: "pipe" });
    execFileSync("git", ["worktree", "add", "--detach", tempDir, baseSha], { stdio: "pipe" });
    return await analyzeProject({ root: resolveBaseScanRoot(tempDir, baseRelativeDir), ignore });
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", tempDir], { stdio: "pipe" });
    } catch {
      fs4.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
async function upsertComment(token, report, newIssues) {
  if (!token) throw new Error("Missing github-token input.");
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) return;
  const octokit = github.getOctokit(token);
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const issue_number = pullRequest.number;
  const body = renderMarkdownComment(report, newIssues);
  await safeUpsertStickyComment(
    octokit.rest.issues,
    {
      owner,
      repo,
      issue_number
    },
    COMMENT_MARKER,
    body,
    actionWarning
  );
}
run().catch((error) => {
  setActionFailed(error.message);
});
//# sourceMappingURL=action.js.map