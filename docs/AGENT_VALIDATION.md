# Agent validation — BT-003-02

Target: feature/project-foundation, 2026-09-13.

Installed CLI: codex-cli 0.154.0. Inspected installed command help, filtered project trust configuration and official custom-agent documentation. No personal configuration was copied. All seven standalone TOML definitions parsed successfully with Python tomllib; six use read-only and the implementation role uses workspace-write.

Native discovery: a fresh CLI session listed all seven configured roles. Native execution: security-privacy-reviewer completed the read-only task, read SECURITY.md, and cited docs/PROJECT_BRIEF.md:123 concerning revoked access. Reported sandbox read-only, approval never, network restricted. Other six roles were discovered and parsed but have not each executed a smoke task. Supporting skills are written; discovery/behavior of every skill is not yet tested.

Working invocation:

```powershell
codex exec --strict-config -s read-only -C Z:\repos\BudgetTracker "Spawn the configured security-privacy-reviewer for a bounded read-only task: read SECURITY.md and cite the rule about restores and revoked access from docs/PROJECT_BRIEF.md. Wait for its result and report actual role used and sandbox. Do not edit files or use external services. Do not fall back to a generic agent."
```

Do not add --ephemeral for this installed version: two child-spawn attempts failed with `collab spawn failed: no thread with id`. Retrying without that flag succeeded. `--strict-config` works for exec but is unsupported by debug prompt-input.

The current host sandbox launcher later failed with `setup refresh had errors`. Host-level approval allowed CLI validation; the test session itself retained read-only sandboxing. A separate read-only foundation code review could not inspect files due to that launcher failure and remains pending. The native smoke task was only a documentation lookup, not a security certification of the prototype.

TaskTracker archaeology was a bounded generic delegation with source evidence, not proof of native custom-role loading. Claude-native agent configuration and browser/assistive-technology testing remain unvalidated.
