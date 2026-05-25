import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { DEFAULT_IGNORE } from "./constants.js";
import type { Framework } from "./types.js";

const TEST_GLOBS = [
  "**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/__tests__/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/test/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/tests/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/cypress/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}",
  "**/e2e/**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"
];

export interface ScanResult {
  root: string;
  files: string[];
  frameworks: Framework[];
  projectName: string;
  warnings: string[];
}

export async function scanProject(rootInput = ".", ignore: string[] = []): Promise<ScanResult> {
  const root = path.resolve(rootInput);
  const warnings: string[] = [];
  const project = await readProject(root, warnings);
  const files = await fg(TEST_GLOBS, {
    cwd: root,
    absolute: false,
    onlyFiles: true,
    unique: true,
    ignore: [...DEFAULT_IGNORE, ...ignore],
    dot: false
  });

  const normalizedFiles = files.map(toPosix).sort();
  const frameworkSet = new Set(project.frameworks);
  for (const file of normalizedFiles) {
    const fromPath = frameworkFromPath(file);
    if (fromPath !== "unknown") frameworkSet.add(fromPath);
  }

  return {
    root,
    files: normalizedFiles,
    frameworks: [...frameworkSet],
    projectName: project.name,
    warnings
  };
}

export function frameworkFromPath(file: string): Framework {
  const normalized = toPosix(file).toLowerCase();
  if (normalized.includes("/cypress/") || normalized.startsWith("cypress/")) return "cypress";
  if (normalized.includes("playwright") || normalized.includes("/e2e/")) return "playwright";
  return "unknown";
}

export function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

async function readProject(root: string, warnings: string[]): Promise<{ name: string; frameworks: Framework[] }> {
  const packagePath = path.join(root, "package.json");
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    const pkg = JSON.parse(raw) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };
    return {
      name: pkg.name ?? path.basename(root),
      frameworks: detectFrameworks(deps)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`Could not read package.json: ${(error as Error).message}`);
    }
    return { name: path.basename(root), frameworks: [] };
  }
}

function detectFrameworks(deps: Record<string, string | undefined>): Framework[] {
  const frameworks = new Set<Framework>();
  if (deps.jest || deps["@jest/globals"]) frameworks.add("jest");
  if (deps.vitest) frameworks.add("vitest");
  if (deps["@playwright/test"]) frameworks.add("playwright");
  if (deps.cypress) frameworks.add("cypress");
  if (deps.mocha || deps.chai) frameworks.add("mocha");
  return [...frameworks];
}
