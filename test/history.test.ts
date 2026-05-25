import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildHistoryEntry, computeScoreDelta, readHistory, writeHistory } from "../src/history.js";
import type { AssertIQReport, HistoryEntry } from "../src/types.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "assertiq-history-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("history", () => {
  it("returns empty history when file is missing", async () => {
    const history = await readHistory(root);
    expect(history.entries).toEqual([]);
    expect(history.warnings).toEqual([]);
  });

  it("warns and ignores malformed history JSON", async () => {
    await fs.writeFile(path.join(root, "assertiq-history.json"), "{ bad json", "utf8");
    const history = await readHistory(root);
    expect(history.entries).toEqual([]);
    expect(history.warnings).toEqual(["assertiq-history.json: invalid JSON, ignoring history file."]);
  });

  it("caps history to 90 entries on write", async () => {
    const seed = Array.from({ length: 90 }, (_, index) => historyEntry(index));
    await fs.writeFile(path.join(root, "assertiq-history.json"), JSON.stringify(seed), "utf8");
    const next = await writeHistory(root, historyEntry(90));
    expect(next.entries).toHaveLength(90);
    expect(next.entries[0]?.sha).toBe("sha-1");
    expect(next.entries.at(-1)?.sha).toBe("sha-90");
  });

  it("builds score deltas for overall and dimensions", () => {
    const report = reportFixture(77, {
      "assertion-quality": 80,
      "flakiness-risk": 70,
      "isolation-risk": 65,
      "naming-clarity": 78,
      "coverage-balance": 81,
      "dead-test-risk": 88
    });
    const previous = historyEntry(0, 72, {
      "assertion-quality": 75,
      "flakiness-risk": 72,
      "isolation-risk": 67,
      "naming-clarity": 78,
      "coverage-balance": 80,
      "dead-test-risk": 88
    });
    const delta = computeScoreDelta(previous, report);
    expect(delta?.overall).toBe(5);
    expect(delta?.dimensions).toEqual(
      expect.arrayContaining([
        { id: "assertion-quality", value: 5 },
        { id: "flakiness-risk", value: -2 },
        { id: "isolation-risk", value: -2 }
      ])
    );
  });

  it("builds history entries from report snapshots", () => {
    const report = reportFixture(88, {
      "assertion-quality": 90,
      "flakiness-risk": 84,
      "isolation-risk": 80,
      "naming-clarity": 87,
      "coverage-balance": 89,
      "dead-test-risk": 92
    });
    const entry = buildHistoryEntry(report, "abcdef", "2026-05-25T00:00:00.000Z");
    expect(entry.sha).toBe("abcdef");
    expect(entry.score).toBe(88);
    expect(entry.dimensions).toHaveLength(6);
  });
});

function historyEntry(
  index: number,
  score = index,
  dimensionScores: Record<
    "assertion-quality" | "flakiness-risk" | "isolation-risk" | "naming-clarity" | "coverage-balance" | "dead-test-risk",
    number
  > = {
    "assertion-quality": score,
    "flakiness-risk": score,
    "isolation-risk": score,
    "naming-clarity": score,
    "coverage-balance": score,
    "dead-test-risk": score
  }
): HistoryEntry {
  return {
    sha: `sha-${index}`,
    date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    score,
    grade: "C",
    dimensions: Object.entries(dimensionScores).map(([id, value]) => ({
      id: id as HistoryEntry["dimensions"][number]["id"],
      score: value,
      grade: "C"
    }))
  };
}

function reportFixture(
  score: number,
  dimensionScores: Record<
    "assertion-quality" | "flakiness-risk" | "isolation-risk" | "naming-clarity" | "coverage-balance" | "dead-test-risk",
    number
  >
): AssertIQReport {
  return {
    tool: "assertiq",
    version: "0.2.0",
    project: "fixture",
    root: "/tmp/fixture",
    summary: {
      score,
      grade: "B",
      testFiles: 1,
      tests: 2,
      issues: 0,
      frameworks: ["vitest"]
    },
    dimensions: Object.entries(dimensionScores).map(([id, value]) => ({
      id: id as AssertIQReport["dimensions"][number]["id"],
      name: id,
      weight: 0.1,
      score: value,
      grade: "B",
      issueCount: 0
    })),
    issues: [],
    warnings: []
  };
}
