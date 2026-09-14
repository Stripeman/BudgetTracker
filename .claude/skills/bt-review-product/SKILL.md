---
name: bt-review-product
description: Coordinate read-only BudgetTracker UX/UI, usability and accessibility review for meaningful interface changes.
---

Use the three corresponding roles in `.codex/agents/README.md` for the scoped interface change. Review existing isolated fictional-data local/Staging UI; do not modify repository, live data, expected results, deployment state or send messages. Have the implementation owner prepare any disposable scenario requiring mutations.

Record commit plus dirty scope, environment, role, workspace, viewport and starting state. Preserve prior entry points and adjacent capabilities. Cover expenditure autofill, merchant retrieval, account privacy, split/settlement explanations, currency context, editor/theme/settings behavior, and import/restore previews as relevant. Test responsive and keyboard paths, focus, labels, errors and recovery. Reviewers must distinguish source inference, automated coverage and actual browser/assistive-technology observations.

Return BT-linked stable findings, severity, confidence, reproduction, expected/actual outcome, evidence, preservation impact, cleanup, recommendation and retest state. Missing runtime means unable to test, not pass. Scope review to meaningful changes; do not trigger the entire team for minor edits.
