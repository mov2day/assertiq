import { analyzeFile as analyzeJavaScriptFile } from "./parser.js";
import { analyzePythonFile } from "./python-parser.js";
import type { FileAnalysis, Framework } from "./types.js";

/** Dispatches supported source files to a static, bundled language adapter. */
export function analyzeFile(root: string, relativeFile: string, detectedFrameworks: Framework[]): Promise<FileAnalysis> {
  return relativeFile.toLowerCase().endsWith(".py")
    ? analyzePythonFile(root, relativeFile)
    : analyzeJavaScriptFile(root, relativeFile, detectedFrameworks);
}
