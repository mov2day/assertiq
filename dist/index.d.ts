type DimensionId = "assertion-quality" | "flakiness-risk" | "isolation-risk" | "naming-clarity" | "coverage-balance" | "dead-test-risk";
type Severity = "low" | "medium" | "high";
type Framework = "jest" | "vitest" | "playwright" | "cypress" | "mocha" | "unknown";
interface TestCaseInfo {
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
interface SkippedBlockInfo {
    name: string;
    file: string;
    line: number;
    column: number;
    kind: "suite" | "test";
    modifier: "skip" | "todo" | "only";
}
type IsolationSignalKind = "mutable-describe-var" | "beforeall-no-afterall" | "spy-no-restore" | "global-mutation" | "module-state";
interface IsolationSignal {
    kind: IsolationSignalKind;
    file: string;
    line: number;
    column: number;
    evidence: string;
    testName?: string;
    suiteName?: string;
}
interface CommentedOutTestInfo {
    file: string;
    line: number;
    evidence: string;
}
interface FileAnalysis {
    file: string;
    framework: Framework;
    testCount: number;
    tests: TestCaseInfo[];
    skippedBlocks: SkippedBlockInfo[];
    commentedOutTests: CommentedOutTestInfo[];
    isolationSignals: IsolationSignal[];
    warnings: string[];
}
interface Issue {
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
    remediation?: string;
    remediationExample?: string;
    documentationUrl?: string;
}
interface DimensionScore {
    id: DimensionId;
    name: string;
    weight: number;
    score: number;
    grade: string;
    issueCount: number;
}
interface ReportSummary {
    score: number;
    grade: string;
    testFiles: number;
    tests: number;
    issues: number;
    frameworks: Framework[];
}
interface HistoryDimensionEntry {
    id: DimensionId;
    score: number;
    grade: string;
}
interface HistoryEntry {
    sha: string;
    date: string;
    score: number;
    grade: string;
    dimensions: HistoryDimensionEntry[];
    ruleCounts?: Record<string, number>;
}
interface DimensionDelta {
    id: DimensionId;
    value: number;
}
interface ScoreDelta {
    overall: number;
    dimensions: DimensionDelta[];
}
interface AssertIQReport {
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
interface AnalyzeOptions {
    root?: string;
    ignore?: string[];
}

declare function analyzeProject(options?: AnalyzeOptions): Promise<AssertIQReport>;

type RuleMode = "off" | "warn" | "error";
interface SuppressionConfig {
    fingerprint: string;
    reason?: string;
}
interface AssertIQConfig {
    rules?: Record<string, RuleMode>;
    ignoreRules?: string[];
    suppressions?: SuppressionConfig[];
}
interface LoadedConfig {
    config: AssertIQConfig;
    warnings: string[];
}
declare function readConfig(root: string): Promise<LoadedConfig>;
declare function applyConfig(issues: Issue[], config: AssertIQConfig): {
    issues: Issue[];
    suppressed: number;
};

declare function renderBadge(report: AssertIQReport): string;

declare function readHistory(root: string): Promise<{
    entries: HistoryEntry[];
    warnings: string[];
}>;
declare function writeHistory(root: string, entry: HistoryEntry): Promise<{
    entries: HistoryEntry[];
    warnings: string[];
}>;
declare function buildHistoryEntry(report: AssertIQReport, sha: string, date?: string): HistoryEntry;
declare function computeScoreDelta(previous: HistoryEntry | undefined, report: AssertIQReport): ScoreDelta | undefined;

declare function renderHtmlReport(report: AssertIQReport): string;

declare function renderMarkdownComment(report: AssertIQReport, newIssues: Issue[]): string;

declare function renderTerminalReport(report: AssertIQReport): string;

declare function renderSarif(report: AssertIQReport): string;

declare function renderDashboard(report: AssertIQReport): string;

declare function gradeForScore(score: number): string;
declare function failsThreshold(score: number, threshold?: string): boolean;
declare function issueFingerprint(issue: Issue): string;

export { type AnalyzeOptions, type AssertIQConfig, type AssertIQReport, type DimensionDelta, type DimensionId, type DimensionScore, type FileAnalysis, type Framework, type HistoryEntry, type IsolationSignal, type Issue, type ReportSummary, type RuleMode, type ScoreDelta, type Severity, type SuppressionConfig, type TestCaseInfo, analyzeProject, applyConfig, buildHistoryEntry, computeScoreDelta, failsThreshold, gradeForScore, issueFingerprint, readConfig, readHistory, renderBadge, renderDashboard, renderHtmlReport, renderMarkdownComment, renderSarif, renderTerminalReport, writeHistory };
