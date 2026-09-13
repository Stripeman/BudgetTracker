# BudgetTracker project state

## Checkpoint and instructions

Date: 2026-09-13. Branch: feature/project-foundation; upstream: origin/feature/project-foundation. Origin: https://github.com/Stripeman/BudgetTracker.git. The checkpoint is the commit containing this state file; obtain its exact SHA with `git log -1 --format=%H`.

Confirmed AGENTS.md, CLAUDE.md and docs/PROJECT_BRIEF.md are tracked in this feature branch and were read in full, along with SECURITY.md, docs/REQUIREMENTS.md and the initial PROJECT_STATE.md. The full root Word brief was read before agent setup/features. Its 161 nonempty paragraphs match the original canonical Markdown requirement text; no additions or conflicts. The app display Agents.md: <none> does not negate these explicit reads.

## Completed safe work

- Connected/fetched origin and checked out the existing tracking branch without an initial commit; preserved the local Word file unchanged and ignored it.
- Recorded Word comparison and source hash; maintained full canonical scope.
- Inspected TaskTracker read-only at Z:/repos/TaskTracker. Recorded real frontend/API/storage/recovery/people/editor/theme seams. No credentials, settings, runtime files or histories copied.
- Added seven native Codex TOML roles, a reproducible generator, agents README and five adapted project skills. All seven parsed and were discovered by fresh Codex CLI 0.154.0. security-privacy-reviewer executed the bounded read-only smoke task successfully.
- Added a pinned Gitleaks/test workflow, restrictive ignore patterns, foundation design/ADR and recovery runbook.
- Added a local, synthetic-only authorization and authenticated-encryption snapshot-preview prototype. Four Node tests passed. Preview has no filesystem writes and is explicitly non-executable; archived grants are stripped.

## Checks and observed results

- Branch/upstream verified as feature/project-foundation / origin/feature/project-foundation.
- `node --test test/*.test.cjs`: 4 passed, 0 failed, Node v22.23.1. Tests cover default denial, administrator separation, explicit grants, expiry/revocation/scope, encrypted round trip, fresh nonce, attachment integrity, no input mutation, grant stripping, wrong-key/tamper/schema/data rejection.
- Python tomllib parsed all 7 definitions; six read-only, one workspace-write. Native security-agent smoke succeeded without --ephemeral. Other agents have discovery evidence only; skill invocation still needs verification.
- `git diff --check`: passed before final documentation edits; repeat at checkpoint.
- GitHub read-only inspection: secret scanning and push protection enabled; Dependabot security updates disabled; main protection endpoint returned 404 Branch not protected. No repository settings were changed.
- Independent security/financial code review could not run because the sandbox helper could not start a process. The smoke task is not a code security review.
- Final staged scan/commit/push outcomes are reported with the checkpoint handoff; do not infer a remote backup until push succeeds.

## Unfinished work and blockers

- No running application, trusted Google identity adapter, API authorization integration, selected durable financial datastore, production-grade monetary model, scheduled backup or executable restore. The snapshot preview is a research prototype; do not expose it to users or real financial data.
- Restore ownership, current revocations, atomic execution, merge/replace/create-new semantics, full financial invariants, secret-free metadata allowlisting, key custody/rotation, independent retention, monitoring and measured RPO/RTO remain pending.
- TaskTracker source mismatch: inspected editor is custom textarea markup, not Tiptap; theme selector is text rather than moon/sun. Preserve BudgetTracker's explicit Tiptap and moon/sun requirements. Do not copy site-admin elevation, invalid-JSON fallback or archived-member activation.
- Codex --ephemeral child spawn fails with no thread with id; use the tested non-ephemeral invocation. Host sandbox process startup now fails with setup refresh had errors; required host checks used approvals without weakening reviewer sandbox. Repair environment before further ordinary validation.
- Claude-native agents are not installed. Claude can read TOML developer_instructions and the supporting skills as documentation, but must not claim native Claude registration.
- Remote workflow execution, branch protections, environment separation and deployment permissions are pending. No PR, merge or deployment performed.

## Exact next steps for Claude

1. Read AGENTS.md, CLAUDE.md, full docs/PROJECT_BRIEF.md, docs/REQUIREMENTS.md, SECURITY.md and this file. Confirm branch/upstream and inspect status; preserve the ignored Word file. Verify checkpoint push against origin before describing it as backed up.
2. Read .codex/agents/README.md, docs/AGENT_VALIDATION.md, docs/TASKTRACKER_REUSE.md, docs/FOUNDATION_DESIGN.md and docs/RECOVERY_RUNBOOK.md. Keep review roles read-only and one implementation writer. Do not assume Codex TOML is native Claude configuration.
3. Resolve sandbox startup failure; rerun the four local tests and obtain independent security/privacy and financial reviews of lib/foundation.cjs and its tests before extending or integrating it. Validate remaining agent/skill invocations as needed, accurately separating discovery from execution.
4. Verify the pushed workflow results; fix CI failures, then configure/verify branch protection and isolated Staging/deployment permissions within authorization. Never push main, merge PRs or deploy Production.
5. Complete BT-001 trusted Google identity and deny-by-default server capability design plus negative tests across every direct/derived surface. Decide financial persistence with an ADR and proof of concurrency/idempotency/atomicity before adopting TaskTracker storage.
6. Complete BT-002 consistent encrypted backups, separate key/operator/retention controls and isolated atomic restores. Reconcile current ownership/revocations explicitly, test corruption/interruption/attachments/balances, and record actual recovery drills before financial modules.
7. Continue the remaining full requirement register in order, preserving editor/theme requirements and maintaining state/README/ignore rules and evidence at each milestone.

User requested a safe checkpoint and handoff, then stop. Do not start new implementation during checkpoint closeout.
