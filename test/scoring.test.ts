import { describe, expect, it } from "vitest";
import { DIMENSIONS } from "../src/constants.js";
import { failsThreshold, gradeForScore } from "../src/scoring.js";

describe("scoring", () => {
  it("maps numeric scores to grade bands and modifiers", () => {
    expect(gradeForScore(100)).toBe("A+");
    expect(gradeForScore(91)).toBe("A-");
    expect(gradeForScore(88)).toBe("B+");
    expect(gradeForScore(76)).toBe("B-");
    expect(gradeForScore(73)).toBe("C+");
    expect(gradeForScore(46)).toBe("D-");
    expect(gradeForScore(44)).toBe("F");
  });

  it("checks letter thresholds by band floor", () => {
    expect(failsThreshold(74, "B")).toBe(true);
    expect(failsThreshold(75, "B")).toBe(false);
    expect(failsThreshold(59, "C")).toBe(true);
    expect(failsThreshold(12, "F")).toBe(false);
  });

  it("uses six dimensions with normalized weights", () => {
    const total = DIMENSIONS.reduce((sum, dimension) => sum + dimension.weight, 0);
    expect(total).toBeCloseTo(1, 8);
    expect(DIMENSIONS.map((dimension) => dimension.id)).toContain("isolation-risk");
  });
});
