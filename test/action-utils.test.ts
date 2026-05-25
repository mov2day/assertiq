import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffIssues,
  escapeActionCommand,
  setActionOutput,
  shouldWriteHistoryForAction,
  splitActionInput
} from "../src/action-utils.js";
import { renderMarkdownComment } from "../src/reporters/markdown.js";
import type { AssertIQReport, Issue } from "../src/types.js";

const baseIssue = issue("assertion-zero", "src/a.test.ts", 4, "old");
const newIssue = issue("flaky-hardcoded-wait", "src/a.test.ts", 8, "new");

describe("action utilities", () => {
  afterEach(() => {
    delete process.env.GITHUB_OUTPUT;
  });

  it("diffs base and head reports by stable issue fingerprint", () => {
    const base = report([baseIssue]);
    const head = report([baseIssue, newIssue]);
    expect(diffIssues(base, head)).toEqual([newIssue]);
  });

  it("splits action list inputs by comma or newline", () => {
    expect(splitActionInput("dist/**, coverage/**\nnode_modules/**")).toEqual([
      "dist/**",
      "coverage/**",
      "node_modules/**"
    ]);
  });

  it("writes multiline outputs using GitHub output file protocol", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "assertiq-output-"));
    const file = path.join(dir, "output");
    process.env.GITHUB_OUTPUT = file;
    setActionOutput("json", "{\n  \"ok\": true\n}");
    expect(await fs.readFile(file, "utf8")).toBe("json<<ASSERTIQ\n{\n  \"ok\": true\n}\nASSERTIQ\n");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("escapes action commands and renders sticky comment marker", () => {
    expect(escapeActionCommand("a%b\nc\rd")).toBe("a%25b%0Ac%0Dd");
    const body = renderMarkdownComment(report([newIssue]), [newIssue]);
    expect(body).toContain("<!-- assertiq-comment -->");
    expect(body).toContain("New risks introduced:** 1");
  });

  it("enables history writes only for push-main with opt-in", () => {
    expect(shouldWriteHistoryForAction(false, "push", "refs/heads/main")).toBe(false);
    expect(shouldWriteHistoryForAction(true, "pull_request", "refs/heads/main")).toBe(false);
    expect(shouldWriteHistoryForAction(true, "push", "refs/heads/feature")).toBe(false);
    expect(shouldWriteHistoryForAction(true, "push", "refs/heads/main")).toBe(true);
  });
});

function issue(ruleId: string, file: string, line: number, evidence: string): Issue {
  return {
    id: `${ruleId}-${line}`,
    ruleId,
    dimension: ruleId.startsWith("flaky") ? "flakiness-risk" : "assertion-quality",
    severity: "high",
    message: `${ruleId} message`,
    file,
    line,
    column: 0,
    testName: "suite > test",
    evidence
  };
}

function report(issues: Issue[]): AssertIQReport {
  return {
    tool: "assertiq",
    version: "0.1.0",
    project: "fixture",
    root: "/tmp/fixture",
    summary: {
      score: 82,
      grade: "B+",
      testFiles: 1,
      tests: 2,
      issues: issues.length,
      frameworks: ["vitest"]
    },
    dimensions: [
      {
        id: "assertion-quality",
        name: "Assertion Quality",
        weight: 0.3,
        score: 82,
        grade: "B+",
        issueCount: issues.filter((item) => item.dimension === "assertion-quality").length
      },
      {
        id: "flakiness-risk",
        name: "Flakiness Risk",
        weight: 0.25,
        score: 80,
        grade: "B",
        issueCount: issues.filter((item) => item.dimension === "flakiness-risk").length
      }
    ],
    issues,
    warnings: []
  };
}
