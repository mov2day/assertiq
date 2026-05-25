import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveActionPaths, resolveBaseScanRoot } from "../src/action-paths.js";

describe("action path resolution", () => {
  it("keeps relative dir comparable for base-vs-head analysis", () => {
    const workspace = "/repo/workspace";
    const resolved = resolveActionPaths("packages/app", workspace);
    expect(resolved.workspaceRoot).toBe(path.resolve(workspace));
    expect(resolved.headRoot).toBe(path.resolve(workspace, "packages/app"));
    expect(resolved.baseRelativeDir).toBe("packages/app");
  });

  it("normalizes absolute dir inside workspace to relative base dir", () => {
    const workspace = "/repo/workspace";
    const absolute = path.resolve(workspace, "packages/app");
    const resolved = resolveActionPaths(absolute, workspace);
    expect(resolved.headRoot).toBe(absolute);
    expect(resolved.baseRelativeDir).toBe("packages/app");
  });

  it("disables base diff for dir outside workspace", () => {
    const workspace = "/repo/workspace";
    const outside = "/tmp/other-project";
    const resolved = resolveActionPaths(outside, workspace);
    expect(resolved.headRoot).toBe(path.resolve(outside));
    expect(resolved.baseRelativeDir).toBeNull();
  });

  it("resolves base scan root from relative directory", () => {
    expect(resolveBaseScanRoot("/tmp/base", "packages/app")).toBe(path.resolve("/tmp/base", "packages/app"));
  });
});
