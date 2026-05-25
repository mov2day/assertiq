import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  splitActionInput
} from "./action-utils.js";
import { COMMENT_MARKER, renderMarkdownComment } from "./reporters/markdown.js";
import { failsThreshold } from "./scoring.js";
import type { AssertIQReport, Issue } from "./types.js";

async function run(): Promise<void> {
  const dirInput = getActionInput("dir") || ".";
  const ignore = splitActionInput(getActionInput("ignore"));
  const failBelow = getActionInput("fail-below") || undefined;
  const postComment = (getActionInput("post-comment") || "true").toLowerCase() !== "false";
  const token = getActionInput("github-token") || process.env.GITHUB_TOKEN || "";
  const paths = resolveActionPaths(dirInput);

  const headReport = await analyzeProject({ root: paths.headRoot, ignore });
  let newIssues: Issue[] = headReport.issues;

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
      if (baseReport) newIssues = diffIssues(baseReport, headReport);
    }
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
