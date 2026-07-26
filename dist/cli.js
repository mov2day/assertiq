#!/usr/bin/env node

// src/cli.ts
import fs6 from "fs/promises";
import path7 from "path";
import { Command, InvalidArgumentError } from "commander";

// src/analyze.ts
import path5 from "path";

// package.json
var package_default = {
  name: "@mov2day/assertiq",
  version: "0.2.0",
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
  { id: "assertion-quality", name: "Assertion Quality", weight: 0.28 },
  { id: "flakiness-risk", name: "Flakiness Risk", weight: 0.23 },
  { id: "isolation-risk", name: "Isolation Risk", weight: 0.1 },
  { id: "naming-clarity", name: "Naming Clarity", weight: 0.13 },
  { id: "coverage-balance", name: "Coverage Balance", weight: 0.18 },
  { id: "dead-test-risk", name: "Dead Test Risk", weight: 0.08 }
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
  "isolation-risk": "#7bc4ff",
  "naming-clarity": "#4f8ef7",
  "coverage-balance": "#5ee8a0",
  "dead-test-risk": "#f76f6f"
};

// src/history.ts
import fs from "fs/promises";
import path from "path";
var HISTORY_FILE = "assertiq-history.json";
var HISTORY_LIMIT = 90;
async function readHistory(root) {
  const historyPath = path.join(root, HISTORY_FILE);
  try {
    const raw = await fs.readFile(historyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return { entries: [], warnings: [`${HISTORY_FILE}: expected JSON array, ignoring history file.`] };
    }
    const entries = parsed.filter(isHistoryEntry).slice(-HISTORY_LIMIT);
    if (entries.length !== parsed.length) {
      return { entries, warnings: [`${HISTORY_FILE}: dropped invalid history entries.`] };
    }
    return { entries, warnings: [] };
  } catch (error) {
    const nodeError = error;
    if (nodeError.code === "ENOENT") return { entries: [], warnings: [] };
    if (nodeError.name === "SyntaxError") {
      return { entries: [], warnings: [`${HISTORY_FILE}: invalid JSON, ignoring history file.`] };
    }
    return { entries: [], warnings: [`${HISTORY_FILE}: ${nodeError.message}`] };
  }
}
function computeScoreDelta(previous, report) {
  if (!previous) return void 0;
  const previousDimensionScores = new Map(previous.dimensions.map((dimension) => [dimension.id, dimension.score]));
  return {
    overall: report.summary.score - previous.score,
    dimensions: report.dimensions.map((dimension) => ({
      id: dimension.id,
      value: dimension.score - (previousDimensionScores.get(dimension.id) ?? dimension.score)
    }))
  };
}
function isHistoryEntry(value) {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return typeof candidate.sha === "string" && typeof candidate.date === "string" && typeof candidate.score === "number" && typeof candidate.grade === "string" && Array.isArray(candidate.dimensions) && candidate.dimensions.every(
    (dimension) => dimension && typeof dimension === "object" && typeof dimension.id === "string" && typeof dimension.score === "number" && typeof dimension.grade === "string"
  );
}

// src/config.ts
import fs2 from "fs/promises";
import path2 from "path";

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

// src/config.ts
async function readConfig(root) {
  const configPath = path2.join(root, "assertiq.config.json");
  try {
    const raw = JSON.parse(await fs2.readFile(configPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { config: {}, warnings: ["assertiq.config.json: expected a JSON object, ignoring config file."] };
    }
    const config = raw;
    const warnings = [];
    if (config.rules && (typeof config.rules !== "object" || Array.isArray(config.rules))) {
      warnings.push("assertiq.config.json: rules must be an object.");
      delete config.rules;
    }
    for (const [ruleId, mode] of Object.entries(config.rules ?? {})) {
      if (mode !== "off" && mode !== "warn" && mode !== "error") {
        warnings.push(`assertiq.config.json: invalid mode for rule ${ruleId}.`);
      }
    }
    if (config.ignoreRules && !Array.isArray(config.ignoreRules)) {
      warnings.push("assertiq.config.json: ignoreRules must be an array.");
      delete config.ignoreRules;
    }
    if (config.suppressions && !Array.isArray(config.suppressions)) {
      warnings.push("assertiq.config.json: suppressions must be an array.");
      delete config.suppressions;
    }
    const suppressions = config.suppressions ?? [];
    for (const suppression of suppressions) {
      if (!suppression || typeof suppression.fingerprint !== "string" || !suppression.fingerprint.trim()) {
        warnings.push("assertiq.config.json: every suppression needs a fingerprint.");
      }
    }
    return { config, warnings };
  } catch (error) {
    const nodeError = error;
    if (nodeError.code === "ENOENT") return { config: {}, warnings: [] };
    if (nodeError.name === "SyntaxError") {
      return { config: {}, warnings: ["assertiq.config.json: invalid JSON, ignoring config file."] };
    }
    return { config: {}, warnings: [`assertiq.config.json: ${nodeError.message}`] };
  }
}
function applyConfig(issues, config) {
  const ignoredRules = /* @__PURE__ */ new Set([...config.ignoreRules ?? [], ...Object.entries(config.rules ?? {}).filter(([, mode]) => mode === "off").map(([ruleId]) => ruleId)]);
  const suppressedFingerprints = new Set(
    (config.suppressions ?? []).filter((item) => item && typeof item.fingerprint === "string").map((item) => item.fingerprint)
  );
  let suppressed = 0;
  const active = issues.flatMap((issue) => {
    if (ignoredRules.has(issue.ruleId) || suppressedFingerprints.has(issueFingerprint(issue))) {
      suppressed += 1;
      return [];
    }
    const mode = config.rules?.[issue.ruleId];
    if (mode === "warn") return [{ ...issue, severity: "low" }];
    return [issue];
  });
  return { issues: active, suppressed };
}

// src/parser.ts
import fs4 from "fs/promises";
import path4 from "path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import * as t from "@babel/types";

// src/scanner.ts
import fs3 from "fs/promises";
import path3 from "path";
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
  const root = path3.resolve(rootInput);
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
  for (const file2 of normalizedFiles) {
    const fromPath = frameworkFromPath(file2);
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
function frameworkFromPath(file2) {
  const normalized = toPosix(file2).toLowerCase();
  if (normalized.includes("/cypress/") || normalized.startsWith("cypress/")) return "cypress";
  if (normalized.includes("playwright") || normalized.includes("/e2e/")) return "playwright";
  return "unknown";
}
function toPosix(file2) {
  return file2.split(path3.sep).join("/");
}
async function readProject(root, warnings) {
  const packagePath = path3.join(root, "package.json");
  try {
    const raw = await fs3.readFile(packagePath, "utf8");
    const pkg = JSON.parse(raw);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };
    return {
      name: pkg.name ?? path3.basename(root),
      frameworks: detectFrameworks(deps)
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      warnings.push(`Could not read package.json: ${error.message}`);
    }
    return { name: path3.basename(root), frameworks: [] };
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
  const absoluteFile = path4.join(root, relativeFile);
  const source = await fs4.readFile(absoluteFile, "utf8");
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
      isolationSignals: [],
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
  const isolationSignals = [];
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
          const suiteSignals = collectSuiteSignals(callPath, args, relativeFile, suiteName);
          for (const signal of suiteSignals.signals) isolationSignals.push(signal);
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
          suiteStack.push({
            name: suiteName,
            skipped: skipped2,
            mutableDescribeVars: suiteSignals.mutableDescribeVars,
            hasAfterEachCleanup: suiteSignals.hasAfterEachCleanup,
            hasAfterEachModuleCleanup: suiteSignals.hasAfterEachModuleCleanup
          });
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
        const extracted = extractTest(
          callPath,
          args,
          testName,
          suiteStack,
          relativeFile,
          framework,
          skipped,
          call.only,
          call.todo
        );
        tests.push(extracted.test);
        isolationSignals.push(...extracted.isolationSignals);
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
    isolationSignals,
    warnings
  };
}
function extractTest(callPath, args, name, suites, file2, framework, skipped, only, todo) {
  const callbackIndex = args.findIndex((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  const callbackPath = callbackIndex >= 0 ? callPath.get(`arguments.${callbackIndex}`) : void 0;
  const metrics = {
    assertions: [],
    hardcodedWaitCount: 0,
    timeDependentCount: 0,
    randomCount: 0,
    externalHttpCount: 0,
    spyOnCount: 0,
    mockRestoreCount: 0,
    restoreAllMocksCount: 0,
    moduleStateCount: 0,
    globalMutationCount: 0,
    mutatedDescribeVars: /* @__PURE__ */ new Set()
  };
  if (callbackPath && (callbackPath.isFunctionExpression() || callbackPath.isArrowFunctionExpression())) {
    callbackPath.traverse({
      CallExpression(innerPath) {
        const assertion = assertionInfo(innerPath.node);
        if (assertion) metrics.assertions.push({ ...assertion, line: locationOf(innerPath.node).line });
        if (isHardcodedWait(innerPath.node)) metrics.hardcodedWaitCount += 1;
        if (isDateNow(innerPath.node)) metrics.timeDependentCount += 1;
        if (isRandom(innerPath.node)) metrics.randomCount += 1;
        if (isJestSpyOn(innerPath.node)) metrics.spyOnCount += 1;
        if (isMockRestore(innerPath.node)) metrics.mockRestoreCount += 1;
        if (isRestoreAllMocks(innerPath.node)) metrics.restoreAllMocksCount += 1;
        if (isModuleStateCall(innerPath.node)) metrics.moduleStateCount += 1;
      },
      NewExpression(innerPath) {
        if (t.isIdentifier(innerPath.node.callee, { name: "Date" })) metrics.timeDependentCount += 1;
      },
      StringLiteral(innerPath) {
        if (isExternalHttp(innerPath.node.value)) metrics.externalHttpCount += 1;
      },
      AssignmentExpression(innerPath) {
        const mutableVars = collectMutableDescribeVars(suites);
        for (const identifier of assignedIdentifiers(innerPath.node.left)) {
          if (mutableVars.has(identifier)) metrics.mutatedDescribeVars.add(identifier);
        }
        if (isGlobalMutationTarget(innerPath.node.left)) metrics.globalMutationCount += 1;
      },
      UpdateExpression(innerPath) {
        if (t.isIdentifier(innerPath.node.argument)) {
          const mutableVars = collectMutableDescribeVars(suites);
          if (mutableVars.has(innerPath.node.argument.name)) metrics.mutatedDescribeVars.add(innerPath.node.argument.name);
        }
      }
    });
  }
  const location = locationOf(callPath.node);
  const fullName = [...suites.map((suite) => suite.name), name].join(" > ");
  const test = {
    name,
    fullName,
    file: file2,
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
  const isolationSignals = collectTestIsolationSignals(metrics, suites, test);
  return { test, isolationSignals };
}
function collectSuiteSignals(callPath, args, file2, suiteName) {
  const result = {
    mutableDescribeVars: /* @__PURE__ */ new Set(),
    hasAfterEachCleanup: false,
    hasAfterEachModuleCleanup: false,
    signals: []
  };
  const callbackIndex = args.findIndex((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  const callback = callbackIndex >= 0 ? args[callbackIndex] : void 0;
  if (!callback || !t.isFunctionExpression(callback) && !t.isArrowFunctionExpression(callback)) return result;
  if (!t.isBlockStatement(callback.body)) return result;
  let beforeAllCount = 0;
  let afterAllCount = 0;
  for (const statement of callback.body.body) {
    if (t.isVariableDeclaration(statement) && (statement.kind === "let" || statement.kind === "var")) {
      for (const declaration of statement.declarations) {
        for (const identifier of patternIdentifiers(declaration.id)) {
          result.mutableDescribeVars.add(identifier);
        }
      }
      continue;
    }
    const expression = expressionCall(statement);
    if (!expression) continue;
    const hook = hookName(expression);
    if (!hook) continue;
    if (hook === "beforeAll") {
      beforeAllCount += 1;
      continue;
    }
    if (hook === "afterAll") {
      afterAllCount += 1;
      continue;
    }
    if (hook === "afterEach") {
      const hookBody = hookCallbackBody(expression.arguments);
      if (!hookBody) continue;
      const hookMetrics = analyzeCleanupCalls(hookBody);
      if (hookMetrics.hasCleanup) result.hasAfterEachCleanup = true;
      if (hookMetrics.hasModuleCleanup) result.hasAfterEachModuleCleanup = true;
    }
  }
  if (beforeAllCount > 0 && afterAllCount === 0) {
    const location = locationOf(callPath.node);
    result.signals.push({
      kind: "beforeall-no-afterall",
      file: file2,
      line: location.line,
      column: location.column,
      suiteName,
      evidence: "beforeAll() without matching afterAll()"
    });
  }
  return result;
}
function collectTestIsolationSignals(metrics, suites, test) {
  const signals = [];
  const hasAfterEachCleanup = suites.some((suite) => suite.hasAfterEachCleanup);
  const hasAfterEachModuleCleanup = suites.some((suite) => suite.hasAfterEachModuleCleanup || suite.hasAfterEachCleanup);
  if (metrics.mutatedDescribeVars.size > 0) {
    signals.push({
      kind: "mutable-describe-var",
      file: test.file,
      line: test.line,
      column: test.column,
      testName: test.fullName,
      evidence: `mutates describe-scope var(s): ${[...metrics.mutatedDescribeVars].sort().join(", ")}`
    });
  }
  if (metrics.spyOnCount > 0 && metrics.mockRestoreCount === 0 && metrics.restoreAllMocksCount === 0 && !hasAfterEachCleanup) {
    signals.push({
      kind: "spy-no-restore",
      file: test.file,
      line: test.line,
      column: test.column,
      testName: test.fullName,
      evidence: `${metrics.spyOnCount} spyOn call(s), no restore in test or afterEach`
    });
  }
  if (metrics.globalMutationCount > 0 && !hasAfterEachCleanup) {
    signals.push({
      kind: "global-mutation",
      file: test.file,
      line: test.line,
      column: test.column,
      testName: test.fullName,
      evidence: `${metrics.globalMutationCount} global assignment(s) without cleanup`
    });
  }
  if (metrics.moduleStateCount > 0 && !hasAfterEachModuleCleanup) {
    signals.push({
      kind: "module-state",
      file: test.file,
      line: test.line,
      column: test.column,
      testName: test.fullName,
      evidence: `${metrics.moduleStateCount} module-state call(s) without afterEach cleanup`
    });
  }
  return signals;
}
function collectMutableDescribeVars(suites) {
  const vars = /* @__PURE__ */ new Set();
  for (const suite of suites) {
    for (const name of suite.mutableDescribeVars) vars.add(name);
  }
  return vars;
}
function assignedIdentifiers(target) {
  if (t.isIdentifier(target)) return [target.name];
  if (t.isMemberExpression(target) || t.isOptionalMemberExpression(target)) return [];
  if (t.isObjectPattern(target)) {
    const values = [];
    for (const property of target.properties) {
      if (t.isRestElement(property)) values.push(...assignedIdentifiers(property.argument));
      if (t.isObjectProperty(property)) values.push(...assignedIdentifiers(property.value));
    }
    return values;
  }
  if (t.isArrayPattern(target)) {
    return target.elements.flatMap((element) => {
      if (!element) return [];
      if (t.isRestElement(element)) return assignedIdentifiers(element.argument);
      return assignedIdentifiers(element);
    });
  }
  if (t.isAssignmentPattern(target)) return assignedIdentifiers(target.left);
  return [];
}
function patternIdentifiers(pattern) {
  return assignedIdentifiers(pattern);
}
function expressionCall(statement) {
  if (!t.isExpressionStatement(statement) || !t.isCallExpression(statement.expression)) return void 0;
  return statement.expression;
}
function hookName(call) {
  const parts = memberParts(t.isCallExpression(call.callee) ? call.callee.callee : call.callee);
  const base = parts[0];
  if (base === "beforeAll") return "beforeAll";
  if (base === "afterAll") return "afterAll";
  if (base === "afterEach") return "afterEach";
  if (base === "beforeEach") return "beforeEach";
  return void 0;
}
function hookCallbackBody(args) {
  const callback = args.find((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  if (!callback) return void 0;
  if (t.isFunctionExpression(callback) || t.isArrowFunctionExpression(callback)) {
    return t.isBlockStatement(callback.body) ? callback.body : void 0;
  }
  return void 0;
}
function analyzeCleanupCalls(body) {
  let hasCleanup = false;
  let hasModuleCleanup = false;
  traverseAst(
    t.file(t.program(body.body)),
    {
      CallExpression(callPath) {
        if (isMockRestore(callPath.node) || isRestoreAllMocks(callPath.node) || isClearOrResetAllMocks(callPath.node)) {
          hasCleanup = true;
        }
        if (isModuleCleanupCall(callPath.node) || isClearOrResetAllMocks(callPath.node) || isRestoreAllMocks(callPath.node)) {
          hasModuleCleanup = true;
        }
      }
    }
  );
  return { hasCleanup, hasModuleCleanup };
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
function isJestSpyOn(node) {
  return memberParts(node.callee).join(".") === "jest.spyOn";
}
function isRestoreAllMocks(node) {
  return memberParts(node.callee).join(".") === "jest.restoreAllMocks";
}
function isClearOrResetAllMocks(node) {
  const callee = memberParts(node.callee).join(".");
  return callee === "jest.clearAllMocks" || callee === "jest.resetAllMocks";
}
function isMockRestore(node) {
  return memberParts(node.callee).at(-1) === "mockRestore";
}
function isModuleStateCall(node) {
  const callee = memberParts(node.callee).join(".");
  return callee === "jest.mock" || callee === "jest.resetModules";
}
function isModuleCleanupCall(node) {
  return memberParts(node.callee).join(".") === "jest.resetModules";
}
function isGlobalMutationTarget(node) {
  if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) return false;
  const parts = memberParts(node);
  if (parts[0] === "global" || parts[0] === "window") return true;
  return parts[0] === "process" && parts[1] === "env";
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
  if (t.isOptionalMemberExpression(node)) {
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
function findCommentedOutTests(source, file2) {
  const results = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^\/\/\s*(it|test|describe|context|specify)\s*(\.skip|\.only|\.todo)?\s*\(/.test(trimmed)) {
      results.push({ file: file2, line: index + 1, evidence: trimmed.slice(0, 140) });
    }
  });
  const blockPattern = /\/\*[\s\S]*?\*\//g;
  for (const match of source.matchAll(blockPattern)) {
    if (/\b(it|test|describe|context|specify)\s*(\.skip|\.only|\.todo)?\s*\(/.test(match[0])) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      results.push({ file: file2, line, evidence: match[0].replace(/\s+/g, " ").slice(0, 140) });
    }
  }
  return results;
}

// src/remediation.ts
var generic = (remediation) => ({ title: "Test quality risk", remediation });
var RULE_METADATA = {
  "assertion-zero": { title: "Missing assertion", remediation: "Add an assertion that verifies the behavior this test is intended to protect." },
  "assertion-weak-single": { title: "Weak assertion", remediation: "Replace the generic assertion with a specific value, state, or behavior assertion." },
  "assertion-snapshot-only": { title: "Snapshot-only assertion", remediation: "Pair the snapshot with focused assertions for the important behavior and values." },
  "assertion-structure-only": { title: "Structure-only assertion", remediation: "Assert meaningful values or behavior in addition to the object shape." },
  "flaky-hardcoded-wait": { title: "Hardcoded wait", remediation: "Wait for a deterministic condition, event, or locator instead of sleeping for a fixed duration." },
  "flaky-time-dependent": { title: "Wall-clock dependency", remediation: "Inject or fake the clock so the test does not depend on the current time." },
  "flaky-random-dependent": { title: "Random dependency", remediation: "Seed or inject randomness so failures can be reproduced reliably." },
  "flaky-external-http": { title: "External network dependency", remediation: "Mock the external service or route the request to a deterministic test server." },
  "naming-vague": { title: "Vague test name", remediation: "Name the test with the scenario and expected behavior it verifies." },
  "naming-no-behavior-signal": { title: "Weak behavior signal", remediation: "Include the condition and expected outcome in the test name." },
  "coverage-single-test-file": { title: "Thin test file", remediation: "Add coverage for the important branches, errors, and boundary conditions." },
  "coverage-happy-path-only": { title: "Happy-path-only coverage", remediation: "Add at least one error, invalid-state, or edge-case test." },
  "dead-skipped-test": { title: "Skipped test", remediation: "Restore the test, replace it with current coverage, or remove it with an explicit decision." },
  "dead-focused-test": { title: "Focused test", remediation: "Remove the only modifier so the complete suite runs in CI." },
  "dead-skipped-block": { title: "Skipped block", remediation: "Restore the suite or remove the stale skipped block." },
  "dead-commented-test": { title: "Commented-out test", remediation: "Delete the dead code or restore it as an active test." },
  "isolation-mutable-describe-var": { title: "Mutable suite state", remediation: "Create test-local state or reset the shared variable before each test." },
  "isolation-beforeall-no-afterall": { title: "Missing suite cleanup", remediation: "Add matching afterAll cleanup for resources created in beforeAll." },
  "isolation-spy-no-restore": { title: "Unrestored spy", remediation: "Restore the spy in afterEach or enable automatic mock restoration." },
  "isolation-global-mutation": { title: "Global mutation", remediation: "Restore the global value in cleanup or isolate the mutation behind a test helper." },
  "isolation-module-state": { title: "Module state leakage", remediation: "Reset module and mock state in afterEach or before the next test." }
};
function metadataForRule(ruleId) {
  return RULE_METADATA[ruleId] ?? generic("Review this finding and make the test deterministic, isolated, and behavior-focused.");
}

// src/rules.ts
var VAGUE_NAME = /^(test\d*|testfoo|foo|bar|baz|works|should work|does stuff|stuff|happy path)$/i;
var BEHAVIOR_WORD = /\b(should|when|given|then|returns?|throws?|rejects?|resolves?|handles?|renders?|creates?|updates?|deletes?|allows?|prevents?|fails?|errors?|invalid|valid|empty|null|undefined|edge|timeout|retry|loads?|saves?|shows?|hides?)\b/i;
var NEGATIVE_OR_EDGE = /\b(error|errors|throw|throws|reject|rejects|fail|fails|invalid|empty|null|undefined|edge|boundary|missing|not found|timeout|denied|unauthorized|forbidden|malformed)\b/i;
function runRulesWithStats(files, config = {}) {
  const issues = [];
  for (const file2 of files) {
    for (const test of file2.tests) {
      assertionQuality(test, issues);
      flakinessRisk(test, issues);
      namingClarity(test, issues);
      deadTestRisk(test, issues);
    }
    coverageBalance(file2, issues);
    for (const skipped of file2.skippedBlocks) {
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
    for (const commented of file2.commentedOutTests) {
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
    for (const signal of file2.isolationSignals) {
      applyIsolationSignal(signal, issues);
    }
  }
  const configured = applyConfig(issues, config);
  return {
    issues: configured.issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId)),
    suppressed: configured.suppressed
  };
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
function coverageBalance(file2, issues) {
  if (file2.tests.length === 0) return;
  if (file2.tests.length === 1) {
    const test = file2.tests[0];
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
  const runnableTests = file2.tests.filter((test) => !test.skipped && !test.todo);
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
function applyIsolationSignal(signal, issues) {
  if (signal.kind === "mutable-describe-var") {
    const testMeta2 = signal.testName ? { testName: signal.testName } : {};
    pushIssue(issues, {
      ruleId: "isolation-mutable-describe-var",
      dimension: "isolation-risk",
      severity: "medium",
      message: "Describe-scope mutable variable is mutated inside a test.",
      file: signal.file,
      line: signal.line,
      column: signal.column,
      ...testMeta2,
      evidence: signal.evidence
    });
    return;
  }
  if (signal.kind === "beforeall-no-afterall") {
    const suiteMeta = signal.suiteName ? { testName: signal.suiteName } : {};
    pushIssue(issues, {
      ruleId: "isolation-beforeall-no-afterall",
      dimension: "isolation-risk",
      severity: "high",
      message: "Suite uses beforeAll without a matching afterAll cleanup.",
      file: signal.file,
      line: signal.line,
      column: signal.column,
      ...suiteMeta,
      evidence: signal.evidence
    });
    return;
  }
  if (signal.kind === "spy-no-restore") {
    const testMeta2 = signal.testName ? { testName: signal.testName } : {};
    pushIssue(issues, {
      ruleId: "isolation-spy-no-restore",
      dimension: "isolation-risk",
      severity: "high",
      message: "spyOn is used without restoring mocks in test or afterEach.",
      file: signal.file,
      line: signal.line,
      column: signal.column,
      ...testMeta2,
      evidence: signal.evidence
    });
    return;
  }
  if (signal.kind === "global-mutation") {
    const testMeta2 = signal.testName ? { testName: signal.testName } : {};
    pushIssue(issues, {
      ruleId: "isolation-global-mutation",
      dimension: "isolation-risk",
      severity: "medium",
      message: "Global state is mutated inside a test without cleanup.",
      file: signal.file,
      line: signal.line,
      column: signal.column,
      ...testMeta2,
      evidence: signal.evidence
    });
    return;
  }
  const testMeta = signal.testName ? { testName: signal.testName } : {};
  pushIssue(issues, {
    ruleId: "isolation-module-state",
    dimension: "isolation-risk",
    severity: "low",
    message: "Module state is mocked/reset in test without afterEach cleanup.",
    file: signal.file,
    line: signal.line,
    column: signal.column,
    ...testMeta,
    evidence: signal.evidence
  });
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
  const metadata = metadataForRule(issue.ruleId);
  issues.push({
    ...issue,
    remediation: metadata.remediation,
    ...metadata.example ? { remediationExample: metadata.example } : {},
    ...metadata.documentationUrl ? { documentationUrl: metadata.documentationUrl } : {},
    id: stableIssueId(issue)
  });
}

// src/analyze.ts
async function analyzeProject(options2 = {}) {
  const root = path5.resolve(options2.root ?? ".");
  const loadedConfig = await readConfig(root);
  const scan = await scanProject(root, options2.ignore ?? []);
  const files = await Promise.all(scan.files.map((file2) => analyzeFile(root, file2, scan.frameworks)));
  const ruleResult = runRulesWithStats(files, loadedConfig.config);
  const issues = ruleResult.issues;
  const history = await readHistory(root);
  const warnings = [...scan.warnings, ...files.flatMap((file2) => file2.warnings), ...history.warnings, ...loadedConfig.warnings];
  if (ruleResult.suppressed > 0) warnings.push(`${ruleResult.suppressed} issue(s) suppressed by assertiq.config.json.`);
  const testCount = files.reduce((sum, file2) => sum + file2.testCount, 0);
  const frameworks = uniqueFrameworks([
    ...scan.frameworks,
    ...files.map((file2) => file2.framework)
  ]);
  if (scan.files.length === 0) warnings.push("No test files found.");
  if (testCount === 0) warnings.push("No tests detected.");
  const dimensions = scoreDimensions(issues, testCount);
  const score = testCount === 0 ? 0 : overallScore(dimensions);
  const report = {
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
    history: history.entries,
    warnings
  };
  const scoreDelta = computeScoreDelta(history.entries.at(-1), report);
  if (scoreDelta) report.scoreDelta = scoreDelta;
  return report;
}
function uniqueFrameworks(frameworks) {
  const clean = frameworks.filter((framework) => framework !== "unknown");
  return [...new Set(clean)].sort();
}

// src/reporters/html.ts
function renderHtmlReport(report) {
  const issues = report.issues.slice(0, 100);
  const sparkline = renderSparkline(report);
  const overallDelta = formatDelta(report.scoreDelta?.overall);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AssertIQ report - ${escapeHtml(report.project)}</title>
<style>
:root{--bg:#0a0c14;--surface:#13151b;--surface2:#1a1d26;--border:#252830;--text:#e4e8f4;--muted:#555e72;--blue:#4f8ef7;--purple:#a78bfa;--warn:#f7c948;--bad:#f76f6f;--good:#5ee8a0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.55}.wrap{max-width:1040px;margin:0 auto;padding:40px 20px 64px}.nav{display:flex;align-items:center;gap:14px;margin-bottom:40px}.mark{width:44px;height:44px;border-radius:11px;background:#050712;position:relative;border:1px solid var(--border)}.mark:before,.mark:after{content:"";position:absolute;top:13px;width:6px;height:18px;border:2px solid var(--blue)}.mark:before{left:10px;border-right:0}.mark:after{right:10px;border-left:0}.check{position:absolute;left:16px;top:17px;width:16px;height:9px;border-left:3px solid var(--purple);border-bottom:3px solid var(--purple);transform:rotate(-45deg)}.brand{font-size:22px;font-weight:800}.brand span{color:var(--purple)}.mono{font-family:"SFMono-Regular",Consolas,monospace}.hero{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:end;border-bottom:1px solid var(--border);padding-bottom:32px}.eyebrow{color:var(--blue);font-size:12px;letter-spacing:.14em;text-transform:uppercase}.hero h1{font-size:44px;line-height:1;margin:8px 0 10px}.muted{color:var(--muted)}.score{min-width:220px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:22px;text-align:center}.grade{font-size:64px;line-height:1;font-weight:900;color:var(--purple)}.num{font-size:22px;color:var(--blue);margin-top:8px}.delta{font-size:13px;margin-top:4px}.delta.up{color:var(--good)}.delta.down{color:var(--bad)}.delta.flat{color:var(--muted)}.spark{margin-top:10px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:28px 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px}.dim-name{font-size:13px;color:var(--muted);min-height:40px}.dim-score{font-size:30px;font-weight:800;margin-top:10px}.bar{height:8px;background:#252830;border-radius:999px;overflow:hidden;margin-top:12px}.fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--purple))}.section{margin-top:36px}.section h2{font-size:20px}.issues{display:grid;gap:10px}.issue{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--purple);border-radius:8px;padding:14px}.issue-head{display:flex;gap:10px;justify-content:space-between}.tag{font-size:11px;color:#0a0c14;background:var(--purple);border-radius:999px;padding:2px 8px}.loc{font-size:12px;color:var(--muted);margin-top:6px}.warn{border-left-color:var(--warn)}.bad{border-left-color:var(--bad)}pre{white-space:pre-wrap;color:var(--muted)}@media(max-width:800px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.score{text-align:left}.grade{font-size:48px}}@media(max-width:520px){.grid{grid-template-columns:1fr}.hero h1{font-size:34px}}
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
    <div class="score"><div class="grade">${escapeHtml(report.summary.grade)}</div><div class="num mono">${report.summary.score}/100</div>${renderDeltaBadge(overallDelta)}${sparkline}</div>
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
    ${issue.remediation ? `<div class="muted"><strong>Fix:</strong> ${escapeHtml(issue.remediation)}</div>` : ""}
  </article>`;
}
function renderSparkline(report) {
  const points = [...(report.history ?? []).map((entry) => entry.score), report.summary.score].slice(-30);
  if (points.length < 2) return "";
  const width = 176;
  const height = 36;
  const pad = 2;
  const max = Math.max(...points, 100);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const pathData = points.map((score, index) => {
    const x = index / (points.length - 1) * (width - pad * 2) + pad;
    const y = height - pad - (score - min) / range * (height - pad * 2);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Score trend"><path d="${pathData}" fill="none" stroke="#4f8ef7" stroke-width="2" stroke-linecap="round"/></svg>`;
}
function renderDeltaBadge(delta) {
  if (delta === void 0) return "";
  if (delta > 0) return `<div class="delta up mono">\u2191 +${delta}</div>`;
  if (delta < 0) return `<div class="delta down mono">\u2193 ${delta}</div>`;
  return `<div class="delta flat mono">\u2192 0</div>`;
}
function formatDelta(delta) {
  if (delta === void 0) return void 0;
  return delta;
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
    `OVERALL ${bar(report.summary.score)} ${colorGrade(report.summary.grade)} ${report.summary.score}${renderOverallDelta(report)}`
  ];
  if (report.issues.length > 0) {
    lines.push("", pc.yellow("Top risks:"));
    for (const issue of topIssues(report.issues)) {
      lines.push(`  - ${issue.message} [${issue.ruleId}]`);
      lines.push(`    ${issue.file}:${issue.line}${issue.testName ? ` - ${issue.testName}` : ""}`);
      if (issue.remediation) lines.push(`    Fix: ${issue.remediation}`);
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
function renderOverallDelta(report) {
  const delta = report.scoreDelta?.overall;
  if (delta === void 0) return "";
  if (delta > 0) return ` ${pc.green(`\u2191 +${delta}`)}`;
  if (delta < 0) return ` ${pc.red(`\u2193 ${delta}`)}`;
  return ` ${pc.gray("\u2192 0")}`;
}
function topIssues(issues) {
  const rank = { high: 0, medium: 1, low: 2 };
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 5);
}

// src/reporters/sarif.ts
import path6 from "path";
function renderSarif(report) {
  const rules = [...new Set(report.issues.map((issue) => issue.ruleId))].map((ruleId) => {
    const metadata = metadataForRule(ruleId);
    return {
      id: ruleId,
      name: metadata.title,
      shortDescription: { text: metadata.title },
      fullDescription: { text: metadata.remediation },
      help: { text: metadata.remediation, markdown: `**Remediation:** ${metadata.remediation}` },
      properties: { tags: ["assertiq", "test-quality"] }
    };
  });
  const results = report.issues.map((issue) => toSarifResult(report.root, issue));
  const payload = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "AssertIQ", version: report.version, informationUri: "https://github.com/mov2day/assertiq", rules } },
      results
    }]
  };
  return `${JSON.stringify(payload, null, 2)}
`;
}
function toSarifResult(root, issue) {
  const metadata = metadataForRule(issue.ruleId);
  const file2 = path6.relative(root, path6.resolve(root, issue.file)).split(path6.sep).join("/");
  return {
    ruleId: issue.ruleId,
    level: sarifLevel(issue.severity),
    message: { text: `${issue.message} Evidence: ${issue.evidence}` },
    locations: [{ physicalLocation: {
      artifactLocation: { uri: file2 || issue.file },
      region: { startLine: Math.max(1, issue.line), startColumn: Math.max(1, issue.column || 1) }
    } }],
    fingerprints: { assertiqIssue: issueFingerprint(issue) },
    properties: { remediation: metadata.remediation, ...metadata.documentationUrl ? { documentationUrl: metadata.documentationUrl } : {} }
  };
}
function sarifLevel(severity) {
  return severity === "high" ? "error" : severity === "medium" ? "warning" : "note";
}

// src/reporters/dashboard.ts
function renderDashboard(report) {
  const data = JSON.stringify({
    summary: report.summary,
    dimensions: report.dimensions,
    history: report.history ?? []
  }).replace(/</g, "\\u003c");
  const issueCounts = report.issues.reduce((counts, issue) => {
    counts[issue.ruleId] = (counts[issue.ruleId] ?? 0) + 1;
    return counts;
  }, {});
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AssertIQ dashboard - ${escapeHtml2(report.project)}</title>
<style>body{margin:0;background:#0a0c14;color:#e4e8f4;font:15px system-ui,sans-serif}.wrap{max-width:1100px;margin:auto;padding:32px 20px 60px}.muted{color:#8791a6}.hero{display:flex;justify-content:space-between;gap:20px;align-items:end;border-bottom:1px solid #252830;padding-bottom:24px}.score{font-size:56px;font-weight:900;color:#a78bfa}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}.card,.issue{background:#13151b;border:1px solid #252830;border-radius:8px;padding:16px}.bar{height:8px;background:#252830;border-radius:8px;margin-top:10px}.fill{height:100%;background:linear-gradient(90deg,#4f8ef7,#a78bfa)}.section{margin-top:30px}.issue{margin:10px 0;border-left:4px solid #f7c948}.issue.high{border-left-color:#f76f6f}.tag{font:12px monospace;color:#a78bfa}.chart{width:100%;height:210px;background:#13151b;border:1px solid #252830;border-radius:8px}.legend{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}.legend span{font-size:12px}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}@media(max-width:700px){.hero{display:block}.grid{grid-template-columns:1fr}}</style></head><body><main class="wrap"><section class="hero"><div><div class="muted">ASSERTIQ QUALITY DASHBOARD</div><h1>${escapeHtml2(report.project)}</h1><p class="muted">${report.summary.tests} tests across ${report.summary.testFiles} files</p></div><div><div class="score">${escapeHtml2(report.summary.grade)}</div><div class="muted">${report.summary.score}/100</div></div></section>
<section class="section"><h2>Score trend</h2><canvas id="overall" class="chart" aria-label="Overall score trend"></canvas></section><section class="section"><h2>Dimension trends</h2><div id="dimension-legend" class="legend"></div><canvas id="dimensions" class="chart" aria-label="Dimension score trends"></canvas></section><section class="grid">${report.dimensions.map((d) => `<article class="card"><div class="muted">${escapeHtml2(d.name)}</div><h2>${escapeHtml2(d.grade)} <small>${d.score}/100</small></h2><div class="bar"><div class="fill" style="width:${d.score}%"></div></div><div class="muted">${d.issueCount} risk(s)</div></article>`).join("")}</section>
<section class="section"><h2>Latest risks</h2>${report.issues.length ? report.issues.map((issue) => `<article class="issue ${issue.severity}"><div class="row"><strong>${escapeHtml2(issue.message)}</strong><span class="tag">${escapeHtml2(issue.ruleId)}</span></div><div class="muted">${escapeHtml2(issue.file)}:${issue.line}${issue.testName ? ` - ${escapeHtml2(issue.testName)}` : ""}</div><p>${escapeHtml2(issue.remediation ?? "Review this finding and improve the test.")}</p></article>`).join("") : `<p class="muted">No risks detected.</p>`}</section>
<section class="section"><h2>Rule-count trends</h2><div id="rule-legend" class="legend"></div><canvas id="rules" class="chart" aria-label="Historical issue-count trends by rule"></canvas><p id="rule-empty" class="muted"></p></section>${report.warnings.length ? `<section class="section"><h2>Warnings</h2><pre>${escapeHtml2(report.warnings.join("\n"))}</pre></section>` : ""}</main><script>const data=${data};const colors=['#4f8ef7','#a78bfa','#5ee8a0','#f7c948','#f76f6f','#7bc4ff'];function points(values,max){return values.map((v,i)=>[i,Math.max(0,Number(v)||0)]).map(([i,v])=>[i,v/max])}function draw(id,series,max){const c=document.getElementById(id),ctx=c.getContext('2d'),dpr=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.strokeStyle='#252830';ctx.beginPath();ctx.moveTo(12,h-18);ctx.lineTo(w-12,h-18);ctx.stroke();series.forEach((s,index)=>{const values=points(s.values,max);if(!values.length)return;ctx.strokeStyle=colors[index%colors.length];ctx.lineWidth=2;ctx.beginPath();values.forEach(([i,v])=>{const x=12+i*(w-24)/Math.max(1,values.length-1),y=h-18-v*(h-36);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()})}function legend(id,series){const root=document.getElementById(id);series.forEach((s,index)=>{const item=document.createElement('span'),dot=document.createElement('i');dot.className='dot';dot.style.background=colors[index%colors.length];item.append(dot,document.createTextNode(s.name));root.append(item)})}const snapshots=data.history.concat([{score:data.summary.score,dimensions:data.dimensions,ruleCounts:${JSON.stringify(issueCounts).replace(/</g, "\\u003c")}}]);draw('overall',[{name:'Overall',values:snapshots.map(s=>s.score)}],100);const dimensions=data.dimensions.map(d=>({name:d.name,values:snapshots.map(s=>{const found=(s.dimensions||[]).find(x=>x.id===d.id);return found?found.score:d.score})}));legend('dimension-legend',dimensions);draw('dimensions',dimensions,100);const totals={};snapshots.forEach(s=>Object.entries(s.ruleCounts||{}).forEach(([key,value])=>{if(typeof value==='number')totals[key]=(totals[key]||0)+value}));const rules=Object.keys(totals).sort((a,b)=>totals[b]-totals[a]).slice(0,5).map(key=>({name:key,values:snapshots.map(s=>typeof(s.ruleCounts||{})[key]==='number'?(s.ruleCounts||{})[key]:0)}));if(rules.length){legend('rule-legend',rules);draw('rules',rules,Math.max(1,...rules.flatMap(r=>r.values)))}else document.getElementById('rule-empty').textContent='No rule-count history yet.';</script></body></html>`;
}
function escapeHtml2(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

// src/new-risk.ts
var RANK = { low: 0, medium: 1, high: 2 };
function filterNewIssues(issues, minimum) {
  if (!minimum) return issues;
  return issues.filter((issue) => RANK[issue.severity] >= RANK[minimum]);
}
function failsNewRiskGate(issues, minimum, maxIssues) {
  if (!minimum && maxIssues === void 0) return false;
  const relevant = filterNewIssues(issues, minimum);
  return maxIssues !== void 0 ? relevant.length > maxIssues : relevant.length > 0;
}
function parseSeverity(value) {
  const normalized = value.toLowerCase();
  if (normalized !== "low" && normalized !== "medium" && normalized !== "high") {
    throw new Error('Use "low", "medium", or "high".');
  }
  return normalized;
}
function parseNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Use a non-negative integer.");
  return parsed;
}

// src/action-utils.ts
import fs5 from "fs";
function diffIssues(baseReport, headReport) {
  const base = new Set(baseReport.issues.map(issueFingerprint));
  return headReport.issues.filter((issue) => !base.has(issueFingerprint(issue)));
}

// src/cli.ts
var program2 = new Command().name("assertiq").description("Static test intelligence and report cards for JavaScript and TypeScript test suites.").option("--dir <path>", "path to scan", ".").option("--ignore <glob>", "glob pattern to exclude; repeatable", collect, []).option("--html", "write assertiq-report.html").option("--badge", "write assertiq-badge.svg").option("--json", "print JSON report").option("--fail-below <grade>", "exit 1 if overall grade is below A, B, C, D, or F", parseThreshold).option("--fail-on-new <severity>", "fail on issues at or above low, medium, or high", parseSeverity).option("--max-new-issues <count>", "fail when issues exceed count", parseNonNegativeInteger).option("--sarif", "write assertiq-results.sarif").option("--sarif-output <path>", "SARIF output path", "assertiq-results.sarif").option("--dashboard", "write assertiq-dashboard.html").option("--dashboard-output <path>", "dashboard output path", "assertiq-dashboard.html").option("--baseline <path>", "previous AssertIQ JSON report used by new-risk gates").version("0.2.0");
program2.parse(process.argv);
var options = program2.opts();
try {
  const root = path7.resolve(options.dir);
  const report = await analyzeProject({ root, ignore: options.ignore ?? [] });
  if (options.html) {
    await fs6.writeFile(path7.join(root, "assertiq-report.html"), renderHtmlReport(report), "utf8");
  }
  if (options.badge) {
    await fs6.writeFile(path7.join(root, "assertiq-badge.svg"), renderBadge(report), "utf8");
  }
  if (options.sarif) await fs6.writeFile(path7.resolve(root, options.sarifOutput ?? "assertiq-results.sarif"), renderSarif(report), "utf8");
  if (options.dashboard) await fs6.writeFile(path7.resolve(root, options.dashboardOutput ?? "assertiq-dashboard.html"), renderDashboard(report), "utf8");
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
  } else {
    process.stdout.write(renderTerminalReport(report));
  }
  if (failsThreshold(report.summary.score, options.failBelow)) {
    process.exitCode = 1;
  }
  if (options.failOnNew || options.maxNewIssues !== void 0) {
    if (!options.baseline) throw new Error("--fail-on-new and --max-new-issues require --baseline <AssertIQ JSON report>.");
    const baseline = await readBaseline(path7.resolve(root, options.baseline));
    if (failsNewRiskGate(diffIssues(baseline, report), options.failOnNew, options.maxNewIssues)) process.exitCode = 1;
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
async function readBaseline(filePath) {
  const parsed = JSON.parse(await fs6.readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.issues)) {
    throw new Error(`Baseline ${filePath} is not an AssertIQ JSON report.`);
  }
  return parsed;
}
//# sourceMappingURL=cli.js.map