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

```yaml
name: Test Intelligence
on: [pull_request]
permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  assertiq:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: mov2day/assertiq@v1
        with:
          fail-below: C
          post-comment: true
```

## Release

Pushes to `main` can auto bump patch version, publish to npm with trusted publishing, and create GitHub release through [.github/workflows/release.yml](/Users/muthu/Documents/GitHub/AssertIQ/.github/workflows/release.yml). Trusted publishing handles auth through OIDC, so no long-lived npm token is needed.

## Badge

```md
![AssertIQ](./assertiq-badge.svg)
```

## Dimensions

AssertIQ scores Assertion Quality, Flakiness Risk, Naming Clarity, Coverage Balance, and Dead Test Risk. Findings are static risk signals, not proof that a test is broken.
