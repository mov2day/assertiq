import fs from "node:fs/promises";
import path from "node:path";
import { issueFingerprint } from "./scoring.js";
import type { Issue, Severity } from "./types.js";

export type RuleMode = "off" | "warn" | "error";

export interface SuppressionConfig {
  fingerprint: string;
  reason?: string;
}

export interface AssertIQConfig {
  rules?: Record<string, RuleMode>;
  ignoreRules?: string[];
  suppressions?: SuppressionConfig[];
}

export interface LoadedConfig {
  config: AssertIQConfig;
  warnings: string[];
}

export async function readConfig(root: string): Promise<LoadedConfig> {
  const configPath = path.join(root, "assertiq.config.json");
  try {
    const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { config: {}, warnings: ["assertiq.config.json: expected a JSON object, ignoring config file."] };
    }
    const config = raw as AssertIQConfig;
    const warnings: string[] = [];
    if (config.rules && (typeof config.rules !== "object" || Array.isArray(config.rules))) {
      warnings.push("assertiq.config.json: rules must be an object.");
      delete config.rules;
    }
    for (const [ruleId, mode] of Object.entries(config.rules ?? {})) {
      if (mode !== "off" && mode !== "warn" && mode !== "error") {
        warnings.push(`assertiq.config.json: invalid mode for rule ${ruleId}.`);
      }
    }
    if (config.ignoreRules && !Array.isArray(config.ignoreRules)) {
      warnings.push("assertiq.config.json: ignoreRules must be an array.");
      delete config.ignoreRules;
    }
    if (config.suppressions && !Array.isArray(config.suppressions)) {
      warnings.push("assertiq.config.json: suppressions must be an array.");
      delete config.suppressions;
    }
    const suppressions = config.suppressions ?? [];
    for (const suppression of suppressions) {
      if (!suppression || typeof suppression.fingerprint !== "string" || !suppression.fingerprint.trim()) {
        warnings.push("assertiq.config.json: every suppression needs a fingerprint.");
      }
    }
    return { config, warnings };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") return { config: {}, warnings: [] };
    if (nodeError.name === "SyntaxError") {
      return { config: {}, warnings: ["assertiq.config.json: invalid JSON, ignoring config file."] };
    }
    return { config: {}, warnings: [`assertiq.config.json: ${nodeError.message}`] };
  }
}

export function applyConfig(issues: Issue[], config: AssertIQConfig): { issues: Issue[]; suppressed: number } {
  const ignoredRules = new Set([...(config.ignoreRules ?? []), ...Object.entries(config.rules ?? {})
    .filter(([, mode]) => mode === "off")
    .map(([ruleId]) => ruleId)]);
  const suppressedFingerprints = new Set(
    (config.suppressions ?? [])
      .filter((item) => item && typeof item.fingerprint === "string")
      .map((item) => item.fingerprint)
  );
  let suppressed = 0;
  const active = issues.flatMap((issue) => {
    if (ignoredRules.has(issue.ruleId) || suppressedFingerprints.has(issueFingerprint(issue))) {
      suppressed += 1;
      return [];
    }
    const mode = config.rules?.[issue.ruleId];
    if (mode === "warn") return [{ ...issue, severity: "low" as Severity }];
    return [issue];
  });
  return { issues: active, suppressed };
}
