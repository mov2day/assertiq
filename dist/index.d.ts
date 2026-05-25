type DimensionId = "assertion-quality" | "flakiness-risk" | "naming-clarity" | "coverage-balance" | "dead-test-risk";
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
interface AssertIQReport {
    tool: "assertiq";
    version: string;
    project: string;
    root: string;
    summary: ReportSummary;
    dimensions: DimensionScore[];
    issues: Issue[];
    warnings: string[];
}
interface AnalyzeOptions {
    root?: string;
    ignore?: string[];
}

declare function analyzeProject(options?: AnalyzeOptions): Promise<AssertIQReport>;

declare function renderBadge(report: AssertIQReport): string;

declare function renderHtmlReport(report: AssertIQReport): string;

declare function renderMarkdownComment(report: AssertIQReport, newIssues: Issue[]): string;

declare function renderTerminalReport(report: AssertIQReport): string;

declare function gradeForScore(score: number): string;
declare function failsThreshold(score: number, threshold?: string): boolean;
declare function issueFingerprint(issue: Issue): string;

export { type AnalyzeOptions, type AssertIQReport, type DimensionId, type DimensionScore, type FileAnalysis, type Framework, type Issue, type ReportSummary, type Severity, type TestCaseInfo, analyzeProject, failsThreshold, gradeForScore, issueFingerprint, renderBadge, renderHtmlReport, renderMarkdownComment, renderTerminalReport };
