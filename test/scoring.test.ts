import { describe, expect, it } from "vitest";
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
});
