import fs from "node:fs/promises";
import path from "node:path";
import type { AssertIQReport, HistoryEntry, ScoreDelta } from "./types.js";

const HISTORY_FILE = "assertiq-history.json";
const HISTORY_LIMIT = 90;

export async function readHistory(root: string): Promise<{ entries: HistoryEntry[]; warnings: string[] }> {
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
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") return { entries: [], warnings: [] };
    if (nodeError.name === "SyntaxError") {
      return { entries: [], warnings: [`${HISTORY_FILE}: invalid JSON, ignoring history file.`] };
    }
    return { entries: [], warnings: [`${HISTORY_FILE}: ${nodeError.message}`] };
  }
}

export async function writeHistory(
  root: string,
  entry: HistoryEntry
): Promise<{ entries: HistoryEntry[]; warnings: string[] }> {
  const { entries, warnings } = await readHistory(root);
  const next = [...entries, entry].slice(-HISTORY_LIMIT);
  await fs.writeFile(path.join(root, HISTORY_FILE), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { entries: next, warnings };
}

export function buildHistoryEntry(report: AssertIQReport, sha: string, date = new Date().toISOString()): HistoryEntry {
  return {
    sha,
    date,
    score: report.summary.score,
    grade: report.summary.grade,
    dimensions: report.dimensions.map((dimension) => ({
      id: dimension.id,
      score: dimension.score,
      grade: dimension.grade
    }))
  };
}

export function computeScoreDelta(previous: HistoryEntry | undefined, report: AssertIQReport): ScoreDelta | undefined {
  if (!previous) return undefined;
  const previousDimensionScores = new Map(previous.dimensions.map((dimension) => [dimension.id, dimension.score]));
  return {
    overall: report.summary.score - previous.score,
    dimensions: report.dimensions.map((dimension) => ({
      id: dimension.id,
      value: dimension.score - (previousDimensionScores.get(dimension.id) ?? dimension.score)
    }))
  };
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HistoryEntry>;
  return (
    typeof candidate.sha === "string" &&
    typeof candidate.date === "string" &&
    typeof candidate.score === "number" &&
    typeof candidate.grade === "string" &&
    Array.isArray(candidate.dimensions) &&
    candidate.dimensions.every(
      (dimension) =>
        dimension &&
        typeof dimension === "object" &&
        typeof (dimension as { id?: string }).id === "string" &&
        typeof (dimension as { score?: number }).score === "number" &&
        typeof (dimension as { grade?: string }).grade === "string"
    )
  );
}

