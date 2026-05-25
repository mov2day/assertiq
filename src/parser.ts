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
          suiteStack.push({ name: suiteName, skipped });
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
): TestCaseInfo {
  const callbackIndex = args.findIndex((arg) => t.isFunctionExpression(arg) || t.isArrowFunctionExpression(arg));
  const callbackPath = callbackIndex >= 0 ? callPath.get(`arguments.${callbackIndex}` as "arguments.0") : undefined;
  const metrics = {
    assertions: [] as AssertionInfo[],
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
