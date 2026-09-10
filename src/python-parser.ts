import fs from "node:fs/promises";
import path from "node:path";
import type { AssertionInfo, FileAnalysis, IsolationSignal, SkippedBlockInfo, TestCaseInfo } from "./types.js";

interface ClassContext { name: string; indent: number; mutable: Set<string>; skipped: boolean }

/**
 * A deliberately small, indentation-aware pytest extractor. It never executes
 * project code and is intentionally conservative when Python syntax is dynamic.
 */
export async function analyzePythonFile(root: string, relativeFile: string): Promise<FileAnalysis> {
  const source = await fs.readFile(path.join(root, relativeFile), "utf8");
  const lines = source.split(/\r?\n/);
  const tests: TestCaseInfo[] = [];
  const skippedBlocks: SkippedBlockInfo[] = [];
  const isolationSignals: IsolationSignal[] = [];
  const classStack: ClassContext[] = [];
  const moduleMutable = new Set<string>();
  const decorators: Array<{ text: string; indent: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = indentation(raw);
    while (classStack.length && indent <= classStack[classStack.length - 1]!.indent) classStack.pop();

    if (trimmed.startsWith("@")) { decorators.push({ text: trimmed, indent }); continue; }
    const activeDecorators = decorators.filter((decorator) => decorator.indent === indent).map((decorator) => decorator.text);
    decorators.length = 0;

    const classMatch = /^class\s+(Test[A-Za-z0-9_]*)\b/.exec(trimmed);
    if (classMatch) {
      classStack.push({ name: classMatch[1]!, indent, mutable: new Set(), skipped: activeDecorators.some((value) => /pytest\.mark\.(skip|skipif|xfail)\b/.test(value)) });
      continue;
    }
    const assignment = /^([A-Za-z_]\w*)\s*(?:\[[^\]]+\])?\s*=\s*(?![=])/.exec(trimmed);
    if (assignment && !trimmed.startsWith("def ")) {
      const currentClass = classStack[classStack.length - 1];
      (currentClass?.mutable ?? moduleMutable).add(assignment[1]!);
    }

    const functionMatch = /^(?:async\s+)?def\s+(test_[A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/.exec(trimmed);
    if (!functionMatch) {
      if (isFixture(activeDecorators)) {
        const fixtureEnd = blockEnd(lines, index, indent);
        const fixtureBody = lines.slice(index + 1, fixtureEnd).join("\n");
        if (isStatefulFixture(fixtureBody) && !hasFixtureCleanup(fixtureBody)) {
          isolationSignals.push({ kind: "python-fixture-no-teardown", file: relativeFile, line: index + 1, column: indent, evidence: "stateful pytest fixture without yield, finalizer, or context cleanup" });
        }
      }
      continue;
    }

    const name = functionMatch[1]!;
    const bodyEnd = blockEnd(lines, index, indent);
    const bodyLines = lines.slice(index + 1, bodyEnd);
    const body = bodyLines.join("\n");
    const skipped = activeDecorators.some((value) => /pytest\.mark\.(skip|skipif|xfail)\b/.test(value)) || classStack.some((item) => item.skipped);
    const fullName = [...classStack.map((item) => item.name), name].join(" > ");
    const assertions = extractAssertions(bodyLines, index + 1);
    const test: TestCaseInfo = {
      name,
      fullName,
      file: relativeFile,
      line: index + 1,
      column: indent,
      framework: "pytest",
      skipped,
      only: activeDecorators.some((value) => /pytest\.mark\.(?:only|focus)\b/.test(value)),
      todo: false,
      assertionCount: assertions.length,
      weakAssertionCount: assertions.filter((item) => item.weak).length,
      structureAssertionCount: assertions.filter((item) => item.structureOnly).length,
      snapshotAssertionCount: 0,
      hardcodedWaitCount: count(body, /\b(?:time\.)?sleep\s*\(\s*\d+(?:\.\d+)?/g),
      timeDependentCount: count(body, /\b(?:time\.(?:time|monotonic)|datetime\.(?:now|utcnow)|date\.today)\s*\(/g),
      randomCount: count(body, /\b(?:random\.|secrets\.)\w+\s*\(/g),
      externalHttpCount: count(body, /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0(?::|\/|$))[^\s'\"]+/gi)
    };
    tests.push(test);
    if (skipped || test.only) skippedBlocks.push({ name, file: relativeFile, line: index + 1, column: indent, kind: "test", modifier: test.only ? "only" : "skip" });

    const shared = new Set([...moduleMutable, ...classStack.flatMap((item) => [...item.mutable])]);
    const mutated = [...shared].filter((variable) => new RegExp(`\\b${escapeRegExp(variable)}\\s*(?:[+\\-*/]?=)`).test(body));
    if (mutated.length) isolationSignals.push({ kind: "python-shared-state", file: relativeFile, line: index + 1, column: indent, testName: fullName, evidence: `mutates module/class state: ${mutated.join(", ")}` });
    if (/\b(?:mock\.)?(?:patch|patch\.object)\s*\(/.test(body) && !/\b(?:with\s+.*(?:patch|patch\.object)|\.stop\s*\(|\.stopall\s*\()/.test(body)) {
      isolationSignals.push({ kind: "python-mock-no-cleanup", file: relativeFile, line: index + 1, column: indent, testName: fullName, evidence: "mock patch without context manager or stop cleanup" });
    }
    index = bodyEnd - 1;
  }

  return { file: relativeFile, framework: "pytest", testCount: tests.length, tests, skippedBlocks, commentedOutTests: commentedOutTests(lines, relativeFile), isolationSignals, warnings: [] };
}

function extractAssertions(lines: string[], offset: number): AssertionInfo[] {
  const assertions: AssertionInfo[] = [];
  lines.forEach((line, index) => {
    const value = line.trim();
    if (/^assert\s+/.test(value)) {
      const weak = /^assert\s+(?:True|1|["'].*["'])\s*(?:#.*)?$/.test(value);
      assertions.push({ matcher: "assert", line: offset + index + 1, weak, structureOnly: /\b(?:isinstance|hasattr|\.keys\s*\()/.test(value), snapshot: false });
    }
    if (/\bpytest\.raises\s*\(/.test(value)) assertions.push({ matcher: "pytest.raises", line: offset + index + 1, weak: false, structureOnly: false, snapshot: false });
  });
  return assertions;
}

function blockEnd(lines: string[], start: number, indent: number): number {
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() && !line.trim().startsWith("#") && indentation(line) <= indent) return index;
  }
  return lines.length;
}
function indentation(line: string): number { return line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0; }
function isFixture(decorators: string[]): boolean { return decorators.some((value) => /@pytest\.fixture\b/.test(value)); }
function isStatefulFixture(body: string): boolean { return /\b(?:mock\.)?patch\s*\(|\bmonkeypatch\.(?:setattr|setenv|setitem)\s*\(/.test(body); }
function hasFixtureCleanup(body: string): boolean { return /\byield\b|\.addfinalizer\s*\(|\bwith\s+/.test(body); }
function count(value: string, expression: RegExp): number { return [...value.matchAll(expression)].length; }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function commentedOutTests(lines: string[], file: string) {
  return lines.flatMap((line, index) => /^\s*#\s*(?:async\s+)?def\s+test_\w+\s*\(/.test(line)
    ? [{ file, line: index + 1, evidence: line.trim().slice(0, 140) }]
    : []);
}
