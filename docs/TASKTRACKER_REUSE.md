# TaskTracker reuse inventory — BT-004-01

Read-only source inspection on 2026-09-13 used `Z:/repos/TaskTracker`; the fallback `T:` path was unnecessary. No source, local settings, credentials or runtime data were copied. These are source findings, not runtime validation.

| Area | Actual source | Adaptation decision |
|---|---|---|
| Stack | `package.json`, `api/package.json`, `app/`: browser ES modules, Azure Functions v3/CommonJS, Azure Blob SDK, SWA CLI, Node tests | Preserve frontend/API approach; pin dependencies only after compatibility checks |
| Persistence | `api/_shared/blob.js`: ETag checks/retries, optional blind writes, invalid JSON fallback | Do not reuse ledger storage unchanged; require corruption refusal, idempotency and atomic linked writes |
| Authorization | `api/_shared/auth.js`, `memberRole()` elevates site admins to workspace owner | Reject automatic financial access; trusted Google identity and explicit resource grants required |
| Restore | `api/workspace-archive/index.js:112` restores members as active and writes in multiple stages; site archive is export-only | Reject access resurrection and partial restore behavior; build independent isolated recovery |
| Attachments | `api/_shared/attachments.js`: scoped base64 JSON, 5 MB limit, MIME allowlist | Retain scoping concept; require private storage, content validation and transactional completeness |
| Editor | `app/js/ui/prosetext.js`: custom textarea markup toolbar; no Tiptap found in inspected app/index | Brief/source mismatch: Tiptap Simple/Advanced/customizable remains required and unimplemented |
| Theme | `app/js/ui/theme.js`, `shell.js:1098`: mode/palette preferences and text Light/Dark/System selector | Brief/source mismatch: required moon/sun selector remains required; preserve mode behavior with separate preference keys |
| People/settings | `app/js/ui/peoplepicker.js`, `core/people.js`, `views/settings.js`, `api/_shared/userprefs.js` | Retain selector/settings concepts; use stable identities and capability-filtered financial references |
| Local runtime | `scripts/dev/seed-local-data.mjs`: Azurite/Functions/SWA and forged local identities | Separate fictional seeds, ports and storage; no deployed mock-auth bypass |

The editor/theme mismatches are between the brief's description of TaskTracker and this source checkout, not between Word and Markdown. Do not weaken the requirements or claim those components were verified as reusable. Inspect relevant tests when implementation begins, including theme, theme preference and editor parity tests. TaskTracker deployment behavior does not authorize BudgetTracker Production operations.
