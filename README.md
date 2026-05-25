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
          post-comment: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.fork == false }}
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
          git add assertiq-badge.svg
          git diff --cached --quiet || git commit -m "chore(ci): update AssertIQ badge"
          git push
```

`post-comment` needs `issues: write`. On `pull_request` runs from forks (and Dependabot PRs), `GITHUB_TOKEN` is usually read-only, so comment posting may be skipped. Keep `post-comment` conditional as above, or use a hardened `pull_request_target` comment-only workflow.

When `v1` is released, switch `mov2day/assertiq@v0` to `mov2day/assertiq@v1` to track the latest `v1.x`.

## Release

Pushes to `main` can auto bump patch version, publish to npm with trusted publishing, and create GitHub release through [.github/workflows/release.yml](/Users/muthu/Documents/GitHub/AssertIQ/.github/workflows/release.yml). Trusted publishing handles auth through OIDC, so no long-lived npm token is needed.

## Badge

The workflow above writes `assertiq-badge.svg` on `main`.

```md
![AssertIQ](./assertiq-badge.svg)
```

## Dimensions

AssertIQ scores Assertion Quality, Flakiness Risk, Naming Clarity, Coverage Balance, and Dead Test Risk. Findings are static risk signals, not proof that a test is broken.
