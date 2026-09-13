# BudgetTracker agents

Seven native project agents live here as standalone TOML files for Codex CLI 0.154.0. Each file declares `name`, `description`, `sandbox_mode`, and `developer_instructions`; these are configured agents, not Claude Markdown files. Models inherit the current session. The reviewed generator in `scripts/setup-project-agents.py` is the source for role text; regenerate after changing it. Do not edit generated TOML independently.

| Agent name | When to invoke | Default |
|---|---|---|
| code-archaeologist | Before potential TaskTracker reuse; trace canonical paths and unsafe alternatives | Read-only |
| primary-implementation-agent | Authorized implementation and accepted reviewer fixes | Workspace write |
| ux-ui-reviewer | Meaningful interface changes; visual hierarchy, journeys and preservation | Read-only |
| usability-tester | Meaningful interface changes; independent real-browser task evidence | Read-only |
| accessibility-reviewer | Meaningful interface changes; keyboard, focus, semantics and assistive technology | Read-only |
| security-privacy-reviewer | Identity, access, storage, integration, backups or restores | Read-only |
| financial-accuracy-reviewer | Financial calculations and data-model changes | Read-only |

Use security and financial reviewers at major milestones and before release. Select the relevant roles; do not run the whole team for every small commit. The coordinating parent can be the implementation owner. Never let it and a child implementation agent edit concurrently. Reviewers report findings; the owner applies accepted fixes and obtains retest evidence.

## Invocation

Start a fresh trusted Codex session from this repository:

```powershell
codex -C Z:\repos\BudgetTracker
```

Then request a role by its exact name:

```text
Use code-archaeologist to trace potential TaskTracker attachment reuse. Read-only; return file evidence and gaps.
Use security-privacy-reviewer to review BT-002 restore authorization. Do not edit anything.
Use financial-accuracy-reviewer to review the shared-expense data model and independent expected balances.
Use primary-implementation-agent to implement the accepted BT findings; it is the only writer for this scope.
```

For a noninteractive read-only smoke test:

```powershell
codex exec --strict-config -s read-only -C Z:\repos\BudgetTracker "Spawn security-privacy-reviewer for a read-only task: read SECURITY.md and cite the rule preventing restored access from being resurrected. Wait for its result. Do not change files or use external services."
```

Substitute any exact role name from the table to invoke it. Do not use Claude's `claude --agent` or assume an `@role` file is executable. Fresh sessions are required to verify discovery; this already-running conversation does not dynamically acquire a custom role selection parameter. An ordinary spawned agent instructed to read a role file is a documentation-driven fallback, not proof of native loading.

## Supporting procedures and provenance

Project skills live in `.agents/skills/<name>/SKILL.md`, the Codex project skill location. Invoke with `$bt-trace-code-path`, `$bt-implement-task`, `$bt-review-product`, `$bt-review-security`, or `$bt-review-data-compatibility`. These procedures supplement the native roles; they are not additional configured agents. Keep role boundaries here and repeatable procedures in skills.

Adapted after read-only inspection of `Z:/repos/TaskTracker/.claude/agents/` (the five requested definitions and README) and `.claude/skills/` (README, trace-code-path, implement-task, review-product, review-auth, review-auth-identity and review-data-compatibility). Preserved canonical-path tracing, single-writer handoff, feature preservation, identity lifecycle, field lifecycle and honest browser evidence. Replaced task/Kanban terminology, Claude frontmatter/model names, hardcoded ports, mock roles and Production assumptions. Unrelated specialists, deployment scripts, settings, credentials, runtime data and conversation history were not copied. The five procedures were adapted and condensed, not copied wholesale. Source files had no additional supporting reference assets for these procedures.

Read-only shell sandboxing does not itself constrain external connectors. Reviewer instructions also prohibit mutating connector actions and live-data changes. Implementation uses workspace-write with approval requests disabled by default; protected Git operations may require the coordinating session to perform them under existing user authorization. Never relax a review sandbox to finish a test.

Official format reference: [Codex custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents). Local evidence and operational limitations belong in `docs/AGENT_VALIDATION.md`; configuration files alone do not prove successful invocation.

