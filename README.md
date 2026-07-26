# AssertIQ

Static test intelligence and report cards for JavaScript and TypeScript test suites.

```sh
npx @mov2day/assertiq
npx @mov2day/assertiq --html
npx @mov2day/assertiq --badge
```

AssertIQ parses test files only. It does not execute tests or need project-specific config.

## CLI

```text
--dir <path>          Path to scan. Default: .
--ignore <glob>      Glob pattern to exclude. Repeatable.
--html               Write assertiq-report.html.
--badge              Write assertiq-badge.svg.
--json               Print machine-readable JSON.
--fail-below <grade> Exit 1 below A, B, C, D, or F.
--fail-on-new <severity> Fail on new issues at low, medium, or high (requires --baseline).
--max-new-issues <count> Maximum allowed issues after severity filtering.
--baseline <path>    Previous AssertIQ JSON report for new-risk comparisons.
--sarif              Write assertiq-results.sarif.
--sarif-output <path> Custom SARIF output path.
--dashboard          Write assertiq-dashboard.html.
--dashboard-output <path> Custom dashboard output path.
```

## GitHub Action

Use the latest major tag to auto-pick future patch/minor updates in that major line.
Current major line is `v0`, so use `mov2day/assertiq@v0`.

```yaml
name: Test Intelligence
on:
  pull_request:
  push:
    branches:
      - main
permissions:
  contents: write
  pull-requests: read
  issues: write
  security-events: write

jobs:
  assertiq:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: mov2day/assertiq@v0
        with:
          fail-below: C
          fail-on-new: high
          max-new-issues: 0
          sarif: true
          upload-sarif: true
          post-comment: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork == false }}
          track-history: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Update badge on main
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: npx @mov2day/assertiq --badge
      - name: Commit badge
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add assertiq-badge.svg assertiq-history.json
          git diff --cached --quiet || git commit -m "chore(ci): update AssertIQ badge and history"
          git push
```

`post-comment` needs `issues: write`. On `pull_request` runs from forks (and Dependabot PRs), `GITHUB_TOKEN` is usually read-only, so comment posting may be skipped. Keep `post-comment` conditional as above, or use a hardened `pull_request_target` comment-only workflow.
`track-history` writes `assertiq-history.json` only on `push` to `main` when enabled.

## Configuration and suppressions

Create `assertiq.config.json` to tune rules or suppress intentional findings:

```json
{
  "rules": {
    "assertion-zero": "error",
    "naming-no-behavior-signal": "off"
  },
  "ignoreRules": ["coverage-single-test-file"],
  "suppressions": [
    {
      "fingerprint": "rule|dimension|file||message|evidence",
      "reason": "Intentional contract test."
    }
  ]
}
```

Rules support `off`, `warn`, and `error`. Suppressed findings do not affect scores, gates, reports, or SARIF. Every finding includes suggested remediation in supported reports.

For local new-risk gates, first save a baseline with `assertiq --json > assertiq-baseline.json`, then run `assertiq --baseline assertiq-baseline.json --fail-on-new high`. GitHub Action pull-request runs create this comparison from the PR base automatically.

Use `npx @mov2day/assertiq --dashboard` to generate the self-contained `assertiq-dashboard.html`. It includes score and dimension trends, current risks, and historical rule counts from `assertiq-history.json`.

When `v1` is released, switch `mov2day/assertiq@v0` to `mov2day/assertiq@v1` to track the latest `v1.x`.

## Release

Pushes to `main` can auto bump patch version, publish to npm with trusted publishing, and create GitHub release through [.github/workflows/release.yml](/Users/muthu/Documents/GitHub/AssertIQ/.github/workflows/release.yml). Trusted publishing handles auth through OIDC, so no long-lived npm token is needed.

## Badge

The workflow above writes `assertiq-badge.svg` on `main`.

```md
![AssertIQ](./assertiq-badge.svg)
```

## Trend History

When `track-history` is enabled in GitHub Action, AssertIQ appends a snapshot to `assertiq-history.json` (capped at last 90 entries). Reports show score movement and trend sparkline from this file.

## Dimensions

AssertIQ scores Assertion Quality, Flakiness Risk, Isolation Risk, Naming Clarity, Coverage Balance, and Dead Test Risk. Findings are static risk signals, not proof that a test is broken.
