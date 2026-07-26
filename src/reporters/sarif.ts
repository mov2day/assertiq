import path from "node:path";
import { metadataForRule } from "../remediation.js";
import { issueFingerprint } from "../scoring.js";
import type { AssertIQReport, Issue, Severity } from "../types.js";

export interface SarifReport {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: { driver: { name: string; version: string; informationUri: string; rules: Array<Record<string, unknown>> } };
    results: Array<Record<string, unknown>>;
  }>;
}

export function renderSarif(report: AssertIQReport): string {
  const rules = [...new Set(report.issues.map((issue) => issue.ruleId))].map((ruleId) => {
    const metadata = metadataForRule(ruleId);
    return {
      id: ruleId,
      name: metadata.title,
      shortDescription: { text: metadata.title },
      fullDescription: { text: metadata.remediation },
      help: { text: metadata.remediation, markdown: `**Remediation:** ${metadata.remediation}` },
      properties: { tags: ["assertiq", "test-quality"] }
    };
  });
  const results = report.issues.map((issue) => toSarifResult(report.root, issue));
  const payload: SarifReport = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "AssertIQ", version: report.version, informationUri: "https://github.com/mov2day/assertiq", rules } },
      results
    }]
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function toSarifResult(root: string, issue: Issue): Record<string, unknown> {
  const metadata = metadataForRule(issue.ruleId);
  const file = path.relative(root, path.resolve(root, issue.file)).split(path.sep).join("/");
  return {
    ruleId: issue.ruleId,
    level: sarifLevel(issue.severity),
    message: { text: `${issue.message} Evidence: ${issue.evidence}` },
    locations: [{ physicalLocation: {
      artifactLocation: { uri: file || issue.file },
      region: { startLine: Math.max(1, issue.line), startColumn: Math.max(1, issue.column || 1) }
    } }],
    fingerprints: { assertiqIssue: issueFingerprint(issue) },
    properties: { remediation: metadata.remediation, ...(metadata.documentationUrl ? { documentationUrl: metadata.documentationUrl } : {}) }
  };
}

function sarifLevel(severity: Severity): "error" | "warning" | "note" {
  return severity === "high" ? "error" : severity === "medium" ? "warning" : "note";
}
