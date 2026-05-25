import type { AssertIQReport } from "../types.js";
import { escapeHtml } from "./html.js";

const GRADE_COLOR: Record<string, { bg: string; fg: string }> = {
  A: { bg: "#5ee8a0", fg: "#063a1e" },
  B: { bg: "#a3e87a", fg: "#1a4a00" },
  C: { bg: "#f7c948", fg: "#5a3a00" },
  D: { bg: "#f7a048", fg: "#4a1a00" },
  F: { bg: "#f76f6f", fg: "#3a0000" }
};

export function renderBadge(report: AssertIQReport): string {
  const grade = report.summary.grade;
  const base = grade[0] ?? "F";
  const color = GRADE_COLOR[base] ?? GRADE_COLOR.F!;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="126" height="22" role="img" aria-label="AssertIQ ${escapeHtml(grade)}">
  <title>AssertIQ ${escapeHtml(grade)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".08"/>
    <stop offset="1" stop-color="#000" stop-opacity=".08"/>
  </linearGradient>
  <clipPath id="r"><rect width="126" height="22" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="72" height="22" fill="#0a0c14"/>
    <rect x="72" width="54" height="22" fill="${color.bg}"/>
    <rect width="126" height="22" fill="url(#s)"/>
  </g>
  <g font-family="Verdana,Geneva,sans-serif" font-size="11" text-anchor="middle">
    <text x="36" y="15" fill="#e4e8f4">assertiq</text>
    <text x="99" y="15" fill="${color.fg}" font-weight="700">${escapeHtml(grade)}</text>
  </g>
</svg>
`;
}
