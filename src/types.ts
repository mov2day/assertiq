export type DimensionId =
  | "assertion-quality"
  | "flakiness-risk"
  | "isolation-risk"
  | "naming-clarity"
  | "coverage-balance"
  | "dead-test-risk";

export type Severity = "low" | "medium" | "high";

export type Framework =
  | "jest"
  | "vitest"
  | "playwright"
  | "cypress"
  | "mocha"
  | "unknown";

export interface DimensionDefinition {
  id: DimensionId;
  name: string;
  weight: number;
}

export interface Position {
  line: number;
  column: number;
}

export interface AssertionInfo {
  matcher: string;
  line: number;
  weak: boolean;
  structureOnly: boolean;
  snapshot: boolean;
}

export interface TestCaseInfo {
  name: string;
  fullName: string;
  file: string;
  line: number;
  column: number;
  framework: Framework;
  skipped: boolean;
  only: boolean;
  todo: boolean;
  assertionCount: number;
  weakAssertionCount: number;
  structureAssertionCount: number;
  snapshotAssertionCount: number;
  hardcodedWaitCount: number;
  timeDependentCount: number;
  randomCount: number;
  externalHttpCount: number;
}

export interface SkippedBlockInfo {
  name: string;
  file: string;
  line: number;
  column: number;
  kind: "suite" | "test";
  modifier: "skip" | "todo" | "only";
}

export type IsolationSignalKind =
  | "mutable-describe-var"
  | "beforeall-no-afterall"
  | "spy-no-restore"
  | "global-mutation"
  | "module-state";

export interface IsolationSignal {
  kind: IsolationSignalKind;
  file: string;
  line: number;
  column: number;
  evidence: string;
  testName?: string;
  suiteName?: string;
}

export interface CommentedOutTestInfo {
  file: string;
  line: number;
  evidence: string;
}

export interface FileAnalysis {
  file: string;
  framework: Framework;
  testCount: number;
  tests: TestCaseInfo[];
  skippedBlocks: SkippedBlockInfo[];
  commentedOutTests: CommentedOutTestInfo[];
  isolationSignals: IsolationSignal[];
  warnings: string[];
}

export interface Issue {
  id: string;
  ruleId: string;
  dimension: DimensionId;
  severity: Severity;
  message: string;
  file: string;
  line: number;
  column: number;
  testName?: string;
  evidence: string;
}

export interface DimensionScore {
  id: DimensionId;
  name: string;
  weight: number;
  score: number;
  grade: string;
  issueCount: number;
}

export interface ReportSummary {
  score: number;
  grade: string;
  testFiles: number;
  tests: number;
  issues: number;
  frameworks: Framework[];
}

export interface HistoryDimensionEntry {
  id: DimensionId;
  score: number;
  grade: string;
}

export interface HistoryEntry {
  sha: string;
  date: string;
  score: number;
  grade: string;
  dimensions: HistoryDimensionEntry[];
}

export interface DimensionDelta {
  id: DimensionId;
  value: number;
}

export interface ScoreDelta {
  overall: number;
  dimensions: DimensionDelta[];
}

export interface AssertIQReport {
  tool: "assertiq";
  version: string;
  project: string;
  root: string;
  summary: ReportSummary;
  dimensions: DimensionScore[];
  issues: Issue[];
  history?: HistoryEntry[];
  scoreDelta?: ScoreDelta;
  warnings: string[];
}

export interface AnalyzeOptions {
  root?: string;
  ignore?: string[];
}
