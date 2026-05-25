#!/usr/bin/env node

// src/cli.ts
import fs3 from "fs/promises";
import path4 from "path";
import { Command, InvalidArgumentError } from "commander";

// src/analyze.ts
import path3 from "path";

// package.json
var package_default = {
  name: "@mov2day/assertiq",
  version: "0.1.1",
  description: "Static test intelligence and report cards for JavaScript and TypeScript test suites.",
  type: "module",
  bin: {
    assertiq: "./dist/cli.js"
  },
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  },
  files: [
    "dist",
    "action.yml",
    "README.md",
    "LICENSE"
  ],
  engines: {
    node: ">=22"
  },
  scripts: {
    build: "tsup",
    typecheck: "tsc --noEmit",
    test: "npm run build && vitest run",
    verify: "npm run typecheck && npm test"
  },
  keywords: [
    "test-smells",
    "testing",
    "static-analysis",
    "jest",
    "vitest",
    "playwright",
    "cypress",
    "mocha"
  ],
  license: "MIT",
  publishConfig: {
    access: "public"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/mov2day/assertiq.git"
  },
  bugs: {
    url: "https://github.com/mov2day/assertiq/issues"
  },
  homepage: "https://github.com/mov2day/assertiq#readme",
  dependencies: {
    "@actions/github": "^9.1.1",
    "@babel/parser": "^7.28.5",
    "@babel/traverse": "^7.28.5",
    "@babel/types": "^7.28.5",
    commander: "^14.0.2",
    "fast-glob": "^3.3.3",
    picocolors: "^1.1.1"
  },
  devDependencies: {
    "@types/babel__traverse": "^7.28.0",
    "@types/node": "^24.10.1",
    tsup: "^8.5.1",
    typescript: "^5.9.3",
    vitest: "^4.0.13"
  }
};

// src/constants.ts
var TOOL_VERSION = package_default.version;
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
var DIMENSION_COLORS = {
  "assertion-quality": "#a78bfa",
  "flakiness-risk": "#f7c948",
  "naming-clarity": "#4f8ef7",
  "coverage-balance": "#5ee8a0",
  "dead-test-risk": "#f76f6f"
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
async function analyzeProject(options2 = {}) {
  const root = path3.resolve(options2.root ?? ".");
  const scan = await scanProject(root, options2.ignore ?? []);
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

// src/reporters/html.ts
function renderHtmlReport(report) {
  const issues = report.issues.slice(0, 100);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AssertIQ report - ${escapeHtml(report.project)}</title>
<style>
:root{--bg:#0a0c14;--surface:#13151b;--surface2:#1a1d26;--border:#252830;--text:#e4e8f4;--muted:#555e72;--blue:#4f8ef7;--purple:#a78bfa;--warn:#f7c948;--bad:#f76f6f;--good:#5ee8a0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.55}.wrap{max-width:1040px;margin:0 auto;padding:40px 20px 64px}.nav{display:flex;align-items:center;gap:14px;margin-bottom:40px}.mark{width:44px;height:44px;border-radius:11px;background:#050712;position:relative;border:1px solid var(--border)}.mark:before,.mark:after{content:"";position:absolute;top:13px;width:6px;height:18px;border:2px solid var(--blue)}.mark:before{left:10px;border-right:0}.mark:after{right:10px;border-left:0}.check{position:absolute;left:16px;top:17px;width:16px;height:9px;border-left:3px solid var(--purple);border-bottom:3px solid var(--purple);transform:rotate(-45deg)}.brand{font-size:22px;font-weight:800}.brand span{color:var(--purple)}.mono{font-family:"SFMono-Regular",Consolas,monospace}.hero{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:end;border-bottom:1px solid var(--border);padding-bottom:32px}.eyebrow{color:var(--blue);font-size:12px;letter-spacing:.14em;text-transform:uppercase}.hero h1{font-size:44px;line-height:1;margin:8px 0 10px}.muted{color:var(--muted)}.score{min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:22px;text-align:center}.grade{font-size:64px;line-height:1;font-weight:900;color:var(--purple)}.num{font-size:22px;color:var(--blue);margin-top:8px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:28px 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px}.dim-name{font-size:13px;color:var(--muted);min-height:40px}.dim-score{font-size:30px;font-weight:800;margin-top:10px}.bar{height:8px;background:#252830;border-radius:999px;overflow:hidden;margin-top:12px}.fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--purple))}.section{margin-top:36px}.section h2{font-size:20px}.issues{display:grid;gap:10px}.issue{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--purple);border-radius:8px;padding:14px}.issue-head{display:flex;gap:10px;justify-content:space-between}.tag{font-size:11px;color:#0a0c14;background:var(--purple);border-radius:999px;padding:2px 8px}.loc{font-size:12px;color:var(--muted);margin-top:6px}.warn{border-left-color:var(--warn)}.bad{border-left-color:var(--bad)}pre{white-space:pre-wrap;color:var(--muted)}@media(max-width:800px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.score{text-align:left}.grade{font-size:48px}}@media(max-width:520px){.grid{grid-template-columns:1fr}.hero h1{font-size:34px}}
</style>
</head>
<body>
<main class="wrap">
  <div class="nav"><div class="mark"><div class="check"></div></div><div class="brand">Assert<span>IQ</span></div></div>
  <section class="hero">
    <div>
      <div class="eyebrow mono">Static test intelligence</div>
      <h1>Test suite report card</h1>
      <p class="muted">${escapeHtml(report.project)} - ${report.summary.testFiles} test file(s) - ${report.summary.tests} test(s)</p>
    </div>
    <div class="score"><div class="grade">${escapeHtml(report.summary.grade)}</div><div class="num mono">${report.summary.score}/100</div></div>
  </section>
  <section class="grid">
    ${report.dimensions.map((dimension) => `<article class="card"><div class="dim-name">${escapeHtml(dimension.name)}</div><div class="dim-score" style="color:${DIMENSION_COLORS[dimension.id]}">${escapeHtml(dimension.grade)}</div><div class="muted mono">${dimension.score}/100 - ${dimension.issueCount} risk(s)</div><div class="bar"><div class="fill" style="width:${dimension.score}%"></div></div></article>`).join("")}
  </section>
  <section class="section">
    <h2>Top risks</h2>
    <div class="issues">${issues.length === 0 ? `<p class="muted">No risks detected.</p>` : issues.map(renderIssue).join("")}</div>
  </section>
  ${report.warnings.length > 0 ? `<section class="section"><h2>Warnings</h2><pre>${escapeHtml(report.warnings.join("\n"))}</pre></section>` : ""}
</main>
</body>
</html>
`;
}
function renderIssue(issue) {
  const klass = issue.severity === "high" ? "bad" : issue.severity === "medium" ? "warn" : "";
  return `<article class="issue ${klass}">
    <div class="issue-head"><strong>${escapeHtml(issue.message)}</strong><span class="tag mono">${escapeHtml(issue.ruleId)}</span></div>
    <div class="loc mono">${escapeHtml(issue.file)}:${issue.line}${issue.testName ? ` - ${escapeHtml(issue.testName)}` : ""}</div>
    <div class="muted">${escapeHtml(issue.evidence)}</div>
  </article>`;
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

// src/reporters/badge.ts
var GRADE_COLOR = {
  A: { bg: "#5ee8a0", fg: "#063a1e" },
  B: { bg: "#a3e87a", fg: "#1a4a00" },
  C: { bg: "#f7c948", fg: "#5a3a00" },
  D: { bg: "#f7a048", fg: "#4a1a00" },
  F: { bg: "#f76f6f", fg: "#3a0000" }
};
function renderBadge(report) {
  const grade = report.summary.grade;
  const base = grade[0] ?? "F";
  const color = GRADE_COLOR[base] ?? GRADE_COLOR.F;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="126" height="22" role="img" aria-label="AssertIQ ${escapeHtml(grade)}">
  <title>AssertIQ ${escapeHtml(grade)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
    <stop offset="1" stop-color="#000" stop-opacity=".08"/>
  </linearGradient>
  <clipPath id="r"><rect width="126" height="22" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="72" height="22" fill="#0a0c14"/>
    <rect x="72" width="54" height="22" fill="${color.bg}"/>
    <rect width="126" height="22" fill="url(#s)"/>
  </g>
  <g font-family="Verdana,Geneva,sans-serif" font-size="11" text-anchor="middle">
    <text x="36" y="15" fill="#e4e8f4">assertiq</text>
    <text x="99" y="15" fill="${color.fg}" font-weight="700">${escapeHtml(grade)}</text>
  </g>
</svg>
`;
}

// src/reporters/terminal.ts
import pc from "picocolors";
function renderTerminalReport(report) {
  const lines = [
    pc.cyan("ASSERTIQ TEST INTELLIGENCE"),
    `${report.project} - ${report.summary.testFiles} test file(s) - ${report.summary.tests} test(s)`,
    "",
    ...report.dimensions.map(renderDimension),
    "",
    `OVERALL ${bar(report.summary.score)} ${colorGrade(report.summary.grade)} ${report.summary.score}`
  ];
  if (report.issues.length > 0) {
    lines.push("", pc.yellow("Top risks:"));
    for (const issue of topIssues(report.issues)) {
      lines.push(`  - ${issue.message} [${issue.ruleId}]`);
      lines.push(`    ${issue.file}:${issue.line}${issue.testName ? ` - ${issue.testName}` : ""}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push("", pc.yellow("Warnings:"));
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("", "HTML:   npx @mov2day/assertiq --html", "Badge:  npx @mov2day/assertiq --badge");
  return `${lines.join("\n")}
`;
}
function renderDimension(dimension) {
  return `${dimension.name.padEnd(18)} ${bar(dimension.score)} ${colorGrade(dimension.grade).padEnd(10)} ${String(
    dimension.score
  ).padStart(3)}  ${dimension.issueCount} risk(s)`;
}
function bar(score) {
  const filled = Math.round(score / 10);
  return `[${"#".repeat(filled)}${".".repeat(10 - filled)}]`;
}
function colorGrade(grade) {
  const base = grade[0];
  if (base === "A" || base === "B") return pc.green(grade);
  if (base === "C") return pc.yellow(grade);
  return pc.red(grade);
}
function topIssues(issues) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 5);
}

// src/cli.ts
var program = new Command().name("assertiq").description("Static test intelligence and report cards for JavaScript and TypeScript test suites.").option("--dir <path>", "path to scan", ".").option("--ignore <glob>", "glob pattern to exclude; repeatable", collect, []).option("--html", "write assertiq-report.html").option("--badge", "write assertiq-badge.svg").option("--json", "print JSON report").option("--fail-below <grade>", "exit 1 if overall grade is below A, B, C, D, or F", parseThreshold).version("0.1.0");
program.parse(process.argv);
var options = program.opts();
try {
  const root = path4.resolve(options.dir);
  const report = await analyzeProject({ root, ignore: options.ignore ?? [] });
  if (options.html) {
    await fs3.writeFile(path4.join(root, "assertiq-report.html"), renderHtmlReport(report), "utf8");
  }
  if (options.badge) {
    await fs3.writeFile(path4.join(root, "assertiq-badge.svg"), renderBadge(report), "utf8");
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
  } else {
    process.stdout.write(renderTerminalReport(report));
  }
  if (failsThreshold(report.summary.score, options.failBelow)) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`AssertIQ error: ${error.message}
`);
  process.exitCode = 1;
}
function collect(value, previous) {
  return [...previous, value];
}
function parseThreshold(value) {
  const normalized = value.toUpperCase();
  if (!/^(A|B|C|D|F)$/.test(normalized)) {
    throw new InvalidArgumentError("Use A, B, C, D, or F.");
  }
  return normalized;
}
//# sourceMappingURL=cli.js.map