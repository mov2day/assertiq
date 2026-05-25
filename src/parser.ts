import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { frameworkFromPath } from "./scanner.js";
import type {
  AssertionInfo,
  CommentedOutTestInfo,
  FileAnalysis,
  Framework,
  IsolationSignal,
  SkippedBlockInfo,
  TestCaseInfo
} from "./types.js";

interface CalleeInfo {
  kind: "test" | "suite";
  skipped: boolean;
  only: boolean;
  todo: boolean;
  each: boolean;
}

interface SuiteContext {
  name: string;
  skipped: boolean;
  mutableDescribeVars: Set<string>;
  hasAfterEachCleanup: boolean;
  hasAfterEachModuleCleanup: boolean;
}

interface SuiteSignalResult {
  mutableDescribeVars: Set<string>;
  hasAfterEachCleanup: boolean;
  hasAfterEachModuleCleanup: boolean;
  signals: IsolationSignal[];
}

const TEST_BASES = new Set(["it", "test", "specify"]);
const SUITE_BASES = new Set(["describe", "context"]);
const WEAK_MATCHERS = new Set([
  "assert",
  "ok",
  "toBeTruthy",
  "toBeFalsy",
  "toBeDefined",
  "toBeUndefined",
  "toBeNull",
  "toExist"
]);
const STRUCTURE_MATCHERS = new Set([
  "toHaveProperty",
  "toContainKey",
  "toContainKeys",
  "toMatchObject",
  "objectContaining",
  "arrayContaining"
]);
const SNAPSHOT_MATCHERS = new Set(["toMatchSnapshot", "toMatchInlineSnapshot", "toThrowErrorMatchingSnapshot"]);
const traverseAst = ((traverseModule as unknown as { default?: typeof import("@babel/traverse").default }).default ??
  traverseModule) as unknown as typeof import("@babel/traverse").default;

export async function analyzeFile(root: string, relativeFile: string, detectedFrameworks: Framework[]): Promise<FileAnalysis> {
  const absoluteFile = path.join(root, relativeFile);
  const source = await fs.readFile(absoluteFile, "utf8");
  const pathFramework = frameworkFromPath(relativeFile);
  const framework = pathFramework === "unknown" ? detectedFrameworks[0] ?? "unknown" : pathFramework;
  const commentedOutTests = findCommentedOutTests(source, relativeFile);
  const warnings: string[] = [];

  let ast: t.File;
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
    warnings.push(`${relativeFile}: parse failed: ${(error as Error).message}`);
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

  const parserErrors = (ast as t.File & { errors?: Error[] }).errors ?? [];
  for (const error of parserErrors) {
    warnings.push(`${relativeFile}: parser recovered: ${error.message}`);
  }

  const suiteStack: SuiteContext[] = [];
  const tests: TestCaseInfo[] = [];
  const skippedBlocks: SkippedBlockInfo[] = [];
  const isolationSignals: IsolationSignal[] = [];

  traverseAst(ast, {
    CallExpression: {
      enter(callPath: NodePath<t.CallExpression>) {
        const call = getCalleeInfo(callPath.node);
        if (!call) return;
        const args = getCallableArgs(callPath.node, call.each);
        const name = literalName(args[0]);
        const location = locationOf(callPath.node);

        if (call.kind === "suite") {
          const suiteName = name || "(anonymous suite)";
          const skipped = call.skipped || suiteStack.some((suite) => suite.skipped);
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
            skipped,
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
      exit(callPath: NodePath<t.CallExpression>) {
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

function extractTest(
  callPath: NodePath<t.CallExpression>,
  args: t.CallExpression["arguments"],
  name: string,
  suites: SuiteContext[],
  file: string,
  framework: Framework,
  skipped: boolean,
  only: boolean,
  todo: boolean
): { test: TestCaseInfo; isolationSignals: IsolationSignal[] } {
  const callbackIndex = args.findIndex((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  const callbackPath = callbackIndex >= 0 ? callPath.get(`arguments.${callbackIndex}` as "arguments.0") : undefined;
  const metrics = {
    assertions: [] as AssertionInfo[],
    hardcodedWaitCount: 0,
    timeDependentCount: 0,
    randomCount: 0,
    externalHttpCount: 0,
    spyOnCount: 0,
    mockRestoreCount: 0,
    restoreAllMocksCount: 0,
    moduleStateCount: 0,
    globalMutationCount: 0,
    mutatedDescribeVars: new Set<string>()
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
  const test: TestCaseInfo = {
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
  const isolationSignals = collectTestIsolationSignals(metrics, suites, test);
  return { test, isolationSignals };
}

function collectSuiteSignals(
  callPath: NodePath<t.CallExpression>,
  args: t.CallExpression["arguments"],
  file: string,
  suiteName: string
): SuiteSignalResult {
  const result: SuiteSignalResult = {
    mutableDescribeVars: new Set<string>(),
    hasAfterEachCleanup: false,
    hasAfterEachModuleCleanup: false,
    signals: []
  };
  const callbackIndex = args.findIndex((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  const callback = callbackIndex >= 0 ? args[callbackIndex] : undefined;
  if (!callback || (!t.isFunctionExpression(callback) && !t.isArrowFunctionExpression(callback))) return result;
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
      file,
      line: location.line,
      column: location.column,
      suiteName,
      evidence: "beforeAll() without matching afterAll()"
    });
  }

  return result;
}

function collectTestIsolationSignals(
  metrics: {
    spyOnCount: number;
    mockRestoreCount: number;
    restoreAllMocksCount: number;
    moduleStateCount: number;
    globalMutationCount: number;
    mutatedDescribeVars: Set<string>;
  },
  suites: SuiteContext[],
  test: TestCaseInfo
): IsolationSignal[] {
  const signals: IsolationSignal[] = [];
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
  if (
    metrics.spyOnCount > 0 &&
    metrics.mockRestoreCount === 0 &&
    metrics.restoreAllMocksCount === 0 &&
    !hasAfterEachCleanup
  ) {
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

function collectMutableDescribeVars(suites: SuiteContext[]): Set<string> {
  const vars = new Set<string>();
  for (const suite of suites) {
    for (const name of suite.mutableDescribeVars) vars.add(name);
  }
  return vars;
}

function assignedIdentifiers(target: t.Node): string[] {
  if (t.isIdentifier(target)) return [target.name];
  if (t.isMemberExpression(target) || t.isOptionalMemberExpression(target)) return [];
  if (t.isObjectPattern(target)) {
    const values: string[] = [];
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

function patternIdentifiers(pattern: t.Node): string[] {
  return assignedIdentifiers(pattern);
}

function expressionCall(statement: t.Statement): t.CallExpression | undefined {
  if (!t.isExpressionStatement(statement) || !t.isCallExpression(statement.expression)) return undefined;
  return statement.expression;
}

function hookName(call: t.CallExpression): "beforeAll" | "afterAll" | "afterEach" | "beforeEach" | undefined {
  const parts = memberParts(t.isCallExpression(call.callee) ? call.callee.callee : call.callee);
  const base = parts[0];
  if (base === "beforeAll") return "beforeAll";
  if (base === "afterAll") return "afterAll";
  if (base === "afterEach") return "afterEach";
  if (base === "beforeEach") return "beforeEach";
  return undefined;
}

function hookCallbackBody(args: t.CallExpression["arguments"]): t.BlockStatement | undefined {
  const callback = args.find((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  if (!callback) return undefined;
  if (t.isFunctionExpression(callback) || t.isArrowFunctionExpression(callback)) {
    return t.isBlockStatement(callback.body) ? callback.body : undefined;
  }
  return undefined;
}

function analyzeCleanupCalls(body: t.BlockStatement): { hasCleanup: boolean; hasModuleCleanup: boolean } {
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

function getCalleeInfo(node: t.CallExpression): CalleeInfo | undefined {
  const callee = t.isCallExpression(node.callee) ? node.callee.callee : node.callee;
  const parts = memberParts(callee);
  const base = parts[0];
  if (!base) return undefined;
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
  return undefined;
}

function getCallableArgs(node: t.CallExpression, each: boolean): t.CallExpression["arguments"] {
  if (each && t.isCallExpression(node.callee)) return node.arguments;
  return node.arguments;
}

function literalName(node: t.CallExpression["arguments"][number] | undefined): string | undefined {
  if (!node) return undefined;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  }
  return undefined;
}

function assertionInfo(node: t.CallExpression): Omit<AssertionInfo, "line"> | undefined {
  const matcher = assertionMatcher(node);
  if (!matcher) return undefined;
  return {
    matcher,
    weak: WEAK_MATCHERS.has(matcher),
    structureOnly: STRUCTURE_MATCHERS.has(matcher),
    snapshot: SNAPSHOT_MATCHERS.has(matcher)
  };
}

function assertionMatcher(node: t.CallExpression): string | undefined {
  const callee = node.callee;
  if (t.isIdentifier(callee) && (callee.name === "assert" || callee.name === "ok")) return callee.name;
  if (!t.isMemberExpression(callee)) return undefined;

  const property = propertyName(callee.property);
  if (!property) return undefined;
  const object = callee.object;
  if (t.isCallExpression(object) && isExpectCall(object)) return property;
  if (t.isMemberExpression(object) && chainContains(object, "resolves", "rejects", "not")) return property;

  const parts = memberParts(callee);
  if (parts[0] === "assert") return property;
  if (parts.includes("should")) return property;
  return undefined;
}

function isExpectCall(node: t.CallExpression): boolean {
  return t.isIdentifier(node.callee, { name: "expect" });
}

function chainContains(node: t.MemberExpression, ...names: string[]): boolean {
  const parts = memberParts(node);
  if (!parts.some((part) => names.includes(part))) return false;
  return parts.includes("expect") || parts.includes("assert") || parts.includes("should");
}

function isHardcodedWait(node: t.CallExpression): boolean {
  const parts = memberParts(node.callee);
  const callee = parts.join(".");
  const last = parts.at(-1);
  const waitish =
    last === "setTimeout" ||
    last === "setInterval" ||
    last === "sleep" ||
    last === "delay" ||
    last === "wait" ||
    callee.endsWith(".waitForTimeout");
  return waitish && node.arguments.some((arg) => t.isNumericLiteral(arg) && arg.value > 0);
}

function isDateNow(node: t.CallExpression): boolean {
  return memberParts(node.callee).join(".") === "Date.now";
}

function isRandom(node: t.CallExpression): boolean {
  return memberParts(node.callee).join(".") === "Math.random";
}

function isJestSpyOn(node: t.CallExpression): boolean {
  return memberParts(node.callee).join(".") === "jest.spyOn";
}

function isRestoreAllMocks(node: t.CallExpression): boolean {
  return memberParts(node.callee).join(".") === "jest.restoreAllMocks";
}

function isClearOrResetAllMocks(node: t.CallExpression): boolean {
  const callee = memberParts(node.callee).join(".");
  return callee === "jest.clearAllMocks" || callee === "jest.resetAllMocks";
}

function isMockRestore(node: t.CallExpression): boolean {
  return memberParts(node.callee).at(-1) === "mockRestore";
}

function isModuleStateCall(node: t.CallExpression): boolean {
  const callee = memberParts(node.callee).join(".");
  return callee === "jest.mock" || callee === "jest.resetModules";
}

function isModuleCleanupCall(node: t.CallExpression): boolean {
  return memberParts(node.callee).join(".") === "jest.resetModules";
}

function isGlobalMutationTarget(node: t.Node): boolean {
  if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node)) return false;
  const parts = memberParts(node);
  if (parts[0] === "global" || parts[0] === "window") return true;
  return parts[0] === "process" && parts[1] === "env";
}

function isExternalHttp(value: string): boolean {
  return /^https?:\/\//i.test(value) && !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(value);
}

function memberParts(node: t.Node | null | undefined): string[] {
  if (!node) return [];
  if (t.isIdentifier(node)) return [node.name];
  if (t.isSuper(node) || t.isThisExpression(node)) return [];
  if (t.isCallExpression(node)) return memberParts(node.callee);
  if (t.isMemberExpression(node)) {
    return [...memberParts(node.object), propertyName(node.property)].filter((part): part is string => Boolean(part));
  }
  if (t.isOptionalMemberExpression(node)) {
    return [...memberParts(node.object), propertyName(node.property)].filter((part): part is string => Boolean(part));
  }
  return [];
}

function propertyName(node: t.Node): string | undefined {
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return node.value;
  if (t.isNumericLiteral(node)) return String(node.value);
  return undefined;
}

function locationOf(node: t.Node): { line: number; column: number } {
  return {
    line: node.loc?.start.line ?? 1,
    column: node.loc?.start.column ?? 0
  };
}

function findCommentedOutTests(source: string, file: string): CommentedOutTestInfo[] {
  const results: CommentedOutTestInfo[] = [];
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
