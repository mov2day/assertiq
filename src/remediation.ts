export interface RuleMetadata {
  title: string;
  remediation: string;
  example?: string;
  documentationUrl?: string;
}

const generic = (remediation: string): RuleMetadata => ({ title: "Test quality risk", remediation });

export const RULE_METADATA: Record<string, RuleMetadata> = {
  "assertion-zero": { title: "Missing assertion", remediation: "Add an assertion that verifies the behavior this test is intended to protect." },
  "assertion-weak-single": { title: "Weak assertion", remediation: "Replace the generic assertion with a specific value, state, or behavior assertion." },
  "assertion-snapshot-only": { title: "Snapshot-only assertion", remediation: "Pair the snapshot with focused assertions for the important behavior and values." },
  "assertion-structure-only": { title: "Structure-only assertion", remediation: "Assert meaningful values or behavior in addition to the object shape." },
  "flaky-hardcoded-wait": { title: "Hardcoded wait", remediation: "Wait for a deterministic condition, event, or locator instead of sleeping for a fixed duration." },
  "flaky-time-dependent": { title: "Wall-clock dependency", remediation: "Inject or fake the clock so the test does not depend on the current time." },
  "flaky-random-dependent": { title: "Random dependency", remediation: "Seed or inject randomness so failures can be reproduced reliably." },
  "flaky-external-http": { title: "External network dependency", remediation: "Mock the external service or route the request to a deterministic test server." },
  "naming-vague": { title: "Vague test name", remediation: "Name the test with the scenario and expected behavior it verifies." },
  "naming-no-behavior-signal": { title: "Weak behavior signal", remediation: "Include the condition and expected outcome in the test name." },
  "coverage-single-test-file": { title: "Thin test file", remediation: "Add coverage for the important branches, errors, and boundary conditions." },
  "coverage-happy-path-only": { title: "Happy-path-only coverage", remediation: "Add at least one error, invalid-state, or edge-case test." },
  "dead-skipped-test": { title: "Skipped test", remediation: "Restore the test, replace it with current coverage, or remove it with an explicit decision." },
  "dead-focused-test": { title: "Focused test", remediation: "Remove the only modifier so the complete suite runs in CI." },
  "dead-skipped-block": { title: "Skipped block", remediation: "Restore the suite or remove the stale skipped block." },
  "dead-commented-test": { title: "Commented-out test", remediation: "Delete the dead code or restore it as an active test." },
  "isolation-mutable-describe-var": { title: "Mutable suite state", remediation: "Create test-local state or reset the shared variable before each test." },
  "isolation-beforeall-no-afterall": { title: "Missing suite cleanup", remediation: "Add matching afterAll cleanup for resources created in beforeAll." },
  "isolation-spy-no-restore": { title: "Unrestored spy", remediation: "Restore the spy in afterEach or enable automatic mock restoration." },
  "isolation-global-mutation": { title: "Global mutation", remediation: "Restore the global value in cleanup or isolate the mutation behind a test helper." },
  "isolation-module-state": { title: "Module state leakage", remediation: "Reset module and mock state in afterEach or before the next test." }
};

export function metadataForRule(ruleId: string): RuleMetadata {
  return RULE_METADATA[ruleId] ?? generic("Review this finding and make the test deterministic, isolated, and behavior-focused.");
}
