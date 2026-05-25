import path from "node:path";

export interface ActionPathResolution {
  workspaceRoot: string;
  headRoot: string;
  baseRelativeDir: string | null;
}

export function resolveActionPaths(
  dirInput: string,
  workspaceInput = process.env.GITHUB_WORKSPACE ?? process.cwd()
): ActionPathResolution {
  const workspaceRoot = path.resolve(workspaceInput);
  const headRoot = path.resolve(workspaceRoot, dirInput || ".");
  const baseRelativeDir = isPathInside(workspaceRoot, headRoot) ? path.relative(workspaceRoot, headRoot) || "." : null;
  return { workspaceRoot, headRoot, baseRelativeDir };
}

export function resolveBaseScanRoot(baseWorktreeRoot: string, baseRelativeDir: string): string {
  return path.resolve(baseWorktreeRoot, baseRelativeDir);
}

function isPathInside(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
