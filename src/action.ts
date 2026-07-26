import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import * as github from "@actions/github";
import { analyzeProject } from "./analyze.js";
import { safeUpsertStickyComment } from "./action-comments.js";
import { resolveActionPaths, resolveBaseScanRoot } from "./action-paths.js";
import {
  actionWarning,
  diffIssues,
  getActionInput,
  setActionFailed,
  setActionOutput,
  shouldWriteHistoryForAction,
  splitActionInput
} from "./action-utils.js";
import { buildHistoryEntry, writeHistory } from "./history.js";
import { COMMENT_MARKER, renderMarkdownComment } from "./reporters/markdown.js";
import { renderSarif } from "./reporters/sarif.js";
import { failsNewRiskGate, filterNewIssues, parseNonNegativeInteger, parseSeverity } from "./new-risk.js";
import { failsThreshold } from "./scoring.js";
import type { AssertIQReport, Issue } from "./types.js";

async function run(): Promise<void> {
  const dirInput = getActionInput("dir") || ".";
  const ignore = splitActionInput(getActionInput("ignore"));
  const failBelow = getActionInput("fail-below") || undefined;
  const postComment = (getActionInput("post-comment") || "true").toLowerCase() !== "false";
  const trackHistory = (getActionInput("track-history") || "false").toLowerCase() === "true";
  const failOnNewInput = getActionInput("fail-on-new");
  const failOnNew = failOnNewInput ? parseSeverity(failOnNewInput) : undefined;
  const maxNewInput = getActionInput("max-new-issues");
  const maxNewIssues = maxNewInput ? parseNonNegativeInteger(maxNewInput) : undefined;
  const uploadSarif = (getActionInput("upload-sarif") || "false").toLowerCase() === "true";
  const writeSarif = uploadSarif || (getActionInput("sarif") || "false").toLowerCase() === "true";
  const token = getActionInput("github-token") || process.env.GITHUB_TOKEN || "";
  const paths = resolveActionPaths(dirInput);

  const headReport = await analyzeProject({ root: paths.headRoot, ignore });
  let newIssues: Issue[] = headReport.issues;
  let baseComparisonAvailable = false;

  if (github.context.payload.pull_request) {
    if (!paths.baseRelativeDir) {
      actionWarning(
        `Directory "${dirInput}" resolves outside GITHUB_WORKSPACE, so base-vs-head diff is disabled; reporting head-only risks.`
      );
    } else {
      const baseReport = await analyzeBase(paths.baseRelativeDir, ignore).catch((error: Error) => {
        actionWarning(`Base analysis failed; reporting head-only risks. ${error.message}`);
        return undefined;
      });
      if (baseReport) {
        newIssues = diffIssues(baseReport, headReport);
        baseComparisonAvailable = true;
      }
    }
  }

  if (
    shouldWriteHistoryForAction(trackHistory, github.context.eventName, process.env.GITHUB_REF ?? "")
  ) {
    const sha = process.env.GITHUB_SHA ?? "unknown";
    const writeResult = await writeHistory(paths.headRoot, buildHistoryEntry(headReport, sha));
    for (const warning of writeResult.warnings) actionWarning(warning);
  }

  const isPullRequest = Boolean(github.context.payload.pull_request);
  const gateIssues = isPullRequest && baseComparisonAvailable ? newIssues : [];
  const relevantNewIssues = filterNewIssues(gateIssues, failOnNew);
  const newRiskFailed = failsNewRiskGate(gateIssues, failOnNew, maxNewIssues);
  setActionOutput("new-issues", String(gateIssues.length));
  setActionOutput("new-high-issues", String(gateIssues.filter((issue) => issue.severity === "high").length));
  setActionOutput("new-risk-gate-passed", String(!newRiskFailed));

  if (writeSarif) {
    const sarifPath = path.resolve(paths.headRoot, getActionInput("sarif-output") || "assertiq-results.sarif");
    const sarif = renderSarif(headReport);
    fs.writeFileSync(sarifPath, sarif, "utf8");
    if (uploadSarif) await uploadSarifReport(token, sarif);
  }

  setActionOutput("score", String(headReport.summary.score));
  setActionOutput("grade", headReport.summary.grade);
  setActionOutput("json", JSON.stringify(headReport));

  if (postComment && github.context.payload.pull_request) {
    await upsertComment(token, headReport, newIssues);
  }

  if (failsThreshold(headReport.summary.score, failBelow)) {
    setActionFailed(`AssertIQ grade ${headReport.summary.grade} (${headReport.summary.score}) is below ${failBelow}.`);
  }
  if (newRiskFailed) {
    setActionFailed(`AssertIQ introduced-risk gate failed: ${relevantNewIssues.length} new issue(s) meet the configured threshold.`);
  }
}

async function uploadSarifReport(token: string, sarif: string): Promise<void> {
  if (Buffer.byteLength(sarif, "utf8") > 10 * 1024 * 1024) {
    actionWarning("SARIF report exceeds GitHub's 10 MB upload limit; skipping Code Scanning upload.");
    return;
  }
  if (!token) {
    actionWarning("SARIF upload skipped: missing github-token.");
    return;
  }
  const pullRequest = github.context.payload.pull_request;
  const ref = process.env.GITHUB_REF ?? (pullRequest ? `refs/pull/${pullRequest.number}/merge` : "");
  const commitSha = process.env.GITHUB_SHA ?? "";
  if (!ref || !commitSha) {
    actionWarning("SARIF upload skipped: missing GITHUB_REF or GITHUB_SHA.");
    return;
  }
  try {
    const octokit = github.getOctokit(token);
    await octokit.rest.codeScanning.uploadSarif({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      commit_sha: commitSha,
      ref,
      sarif: gzipSync(Buffer.from(sarif, "utf8")).toString("base64")
    });
  } catch (error) {
    actionWarning(`Could not upload AssertIQ SARIF report: ${(error as Error).message}`);
  }
}

async function analyzeBase(baseRelativeDir: string, ignore: string[]): Promise<AssertIQReport> {
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest?.base?.sha) throw new Error("Missing pull request base SHA.");
  const baseSha = pullRequest.base.sha;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "assertiq-base-"));
  try {
    execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", baseSha], { stdio: "pipe" });
    execFileSync("git", ["worktree", "add", "--detach", tempDir, baseSha], { stdio: "pipe" });
    return await analyzeProject({ root: resolveBaseScanRoot(tempDir, baseRelativeDir), ignore });
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", tempDir], { stdio: "pipe" });
    } catch {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function upsertComment(token: string, report: AssertIQReport, newIssues: Issue[]): Promise<void> {
  if (!token) throw new Error("Missing github-token input.");
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) return;
  const octokit = github.getOctokit(token);
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const issue_number = pullRequest.number;
  const body = renderMarkdownComment(report, newIssues);
  await safeUpsertStickyComment(
    octokit.rest.issues,
    {
      owner,
      repo,
      issue_number
    },
    COMMENT_MARKER,
    body,
    actionWarning
  );
}

run().catch((error: Error) => {
  setActionFailed(error.message);
});
