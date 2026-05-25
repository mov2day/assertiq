import packageJson from "../package.json" with { type: "json" };
import type { DimensionDefinition, DimensionId } from "./types.js";

export const TOOL_VERSION = packageJson.version;

export const DIMENSIONS: DimensionDefinition[] = [
  { id: "assertion-quality", name: "Assertion Quality", weight: 0.28 },
  { id: "flakiness-risk", name: "Flakiness Risk", weight: 0.23 },
  { id: "isolation-risk", name: "Isolation Risk", weight: 0.1 },
  { id: "naming-clarity", name: "Naming Clarity", weight: 0.13 },
  { id: "coverage-balance", name: "Coverage Balance", weight: 0.18 },
  { id: "dead-test-risk", name: "Dead Test Risk", weight: 0.08 }
];

export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/out/**",
  "**/playwright-report/**",
  "**/test-results/**"
];

export const GRADE_FLOORS: Record<"A" | "B" | "C" | "D" | "F", number> = {
  A: 90,
  B: 75,
  C: 60,
  D: 45,
  F: 0
};

export const DIMENSION_COLORS: Record<DimensionId, string> = {
  "assertion-quality": "#a78bfa",
  "flakiness-risk": "#f7c948",
  "isolation-risk": "#7bc4ff",
  "naming-clarity": "#4f8ef7",
  "coverage-balance": "#5ee8a0",
  "dead-test-risk": "#f76f6f"
};
