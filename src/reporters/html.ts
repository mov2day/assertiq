import { DIMENSION_COLORS } from "../constants.js";
import type { AssertIQReport, Issue } from "../types.js";

export function renderHtmlReport(report: AssertIQReport): string {
  const issues = report.issues.slice(0, 100);
  const sparkline = renderSparkline(report);
  const overallDelta = formatDelta(report.scoreDelta?.overall);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AssertIQ report - ${escapeHtml(report.project)}</title>
<style>
:root{--bg:#0a0c14;--surface:#13151b;--surface2:#1a1d26;--border:#252830;--text:#e4e8f4;--muted:#555e72;--blue:#4f8ef7;--purple:#a78bfa;--warn:#f7c948;--bad:#f76f6f;--good:#5ee8a0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.55}.wrap{max-width:1040px;margin:0 auto;padding:40px 20px 64px}.nav{display:flex;align-items:center;gap:14px;margin-bottom:40px}.mark{width:44px;height:44px;border-radius:11px;background:#050712;position:relative;border:1px solid var(--border)}.mark:before,.mark:after{content:"";position:absolute;top:13px;width:6px;height:18px;border:2px solid var(--blue)}.mark:before{left:10px;border-right:0}.mark:after{right:10px;border-left:0}.check{position:absolute;left:16px;top:17px;width:16px;height:9px;border-left:3px solid var(--purple);border-bottom:3px solid var(--purple);transform:rotate(-45deg)}.brand{font-size:22px;font-weight:800}.brand span{color:var(--purple)}.mono{font-family:"SFMono-Regular",Consolas,monospace}.hero{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:end;border-bottom:1px solid var(--border);padding-bottom:32px}.eyebrow{color:var(--blue);font-size:12px;letter-spacing:.14em;text-transform:uppercase}.hero h1{font-size:44px;line-height:1;margin:8px 0 10px}.muted{color:var(--muted)}.score{min-width:220px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:22px;text-align:center}.grade{font-size:64px;line-height:1;font-weight:900;color:var(--purple)}.num{font-size:22px;color:var(--blue);margin-top:8px}.delta{font-size:13px;margin-top:4px}.delta.up{color:var(--good)}.delta.down{color:var(--bad)}.delta.flat{color:var(--muted)}.spark{margin-top:10px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:28px 0}.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px}.dim-name{font-size:13px;color:var(--muted);min-height:40px}.dim-score{font-size:30px;font-weight:800;margin-top:10px}.bar{height:8px;background:#252830;border-radius:999px;overflow:hidden;margin-top:12px}.fill{height:100%;background:linear-gradient(90deg,var(--blue),var(--purple))}.section{margin-top:36px}.section h2{font-size:20px}.issues{display:grid;gap:10px}.issue{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--purple);border-radius:8px;padding:14px}.issue-head{display:flex;gap:10px;justify-content:space-between}.tag{font-size:11px;color:#0a0c14;background:var(--purple);border-radius:999px;padding:2px 8px}.loc{font-size:12px;color:var(--muted);margin-top:6px}.warn{border-left-color:var(--warn)}.bad{border-left-color:var(--bad)}pre{white-space:pre-wrap;color:var(--muted)}@media(max-width:800px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.score{text-align:left}.grade{font-size:48px}}@media(max-width:520px){.grid{grid-template-columns:1fr}.hero h1{font-size:34px}}
</style>
</head>
<body>
<main class="wrap">
  <div class="nav"><div class="mark"><div class="check"></div></div><div class="brand">Assert<span>IQ</span></div></div>
  <section class="hero">
    <div>
      <div class="eyebrow mono">Static test intelligence</div>
      <h1>Test suite report card</h1>
      <p class="muted">${escapeHtml(report.project)} - ${report.summary.testFiles} test file(s) - ${report.summary.tests} test(s)</p>
    </div>
    <div class="score"><div class="grade">${escapeHtml(report.summary.grade)}</div><div class="num mono">${report.summary.score}/100</div>${renderDeltaBadge(overallDelta)}${sparkline}</div>
  </section>
  <section class="grid">
    ${report.dimensions.map((dimension) => `<article class="card"><div class="dim-name">${escapeHtml(dimension.name)}</div><div class="dim-score" style="color:${DIMENSION_COLORS[dimension.id]}">${escapeHtml(dimension.grade)}</div><div class="muted mono">${dimension.score}/100 - ${dimension.issueCount} risk(s)</div><div class="bar"><div class="fill" style="width:${dimension.score}%"></div></div></article>`).join("")}
  </section>
  <section class="section">
    <h2>Top risks</h2>
    <div class="issues">${issues.length === 0 ? `<p class="muted">No risks detected.</p>` : issues.map(renderIssue).join("")}</div>
  </section>
  ${report.warnings.length > 0 ? `<section class="section"><h2>Warnings</h2><pre>${escapeHtml(report.warnings.join("\n"))}</pre></section>` : ""}
</main>
</body>
</html>
`;
}

function renderIssue(issue: Issue): string {
  const klass = issue.severity === "high" ? "bad" : issue.severity === "medium" ? "warn" : "";
  return `<article class="issue ${klass}">
    <div class="issue-head"><strong>${escapeHtml(issue.message)}</strong><span class="tag mono">${escapeHtml(issue.ruleId)}</span></div>
    <div class="loc mono">${escapeHtml(issue.file)}:${issue.line}${issue.testName ? ` - ${escapeHtml(issue.testName)}` : ""}</div>
    <div class="muted">${escapeHtml(issue.evidence)}</div>
  </article>`;
}

function renderSparkline(report: AssertIQReport): string {
  const points = [...(report.history ?? []).map((entry) => entry.score), report.summary.score].slice(-30);
  if (points.length < 2) return "";
  const width = 176;
  const height = 36;
  const pad = 2;
  const max = Math.max(...points, 100);
  const min = Math.min(...points, 0);
  const range = Math.max(1, max - min);
  const pathData = points
    .map((score, index) => {
      const x = (index / (points.length - 1)) * (width - pad * 2) + pad;
      const y = height - pad - ((score - min) / range) * (height - pad * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Score trend"><path d="${pathData}" fill="none" stroke="#4f8ef7" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function renderDeltaBadge(delta: number | undefined): string {
  if (delta === undefined) return "";
  if (delta > 0) return `<div class="delta up mono">↑ +${delta}</div>`;
  if (delta < 0) return `<div class="delta down mono">↓ ${delta}</div>`;
  return `<div class="delta flat mono">→ 0</div>`;
}

function formatDelta(delta: number | undefined): number | undefined {
  if (delta === undefined) return undefined;
  return delta;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
