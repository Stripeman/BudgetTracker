# Security review — bills, budgets, forecast and merchants (2026-09-13)

Independent, read-only review of commit `773c979` plus the uncommitted merchant work, with 17 probe tests run in a scratch copy using fictional data. Scope: `api/recurring`, `api/_shared/bills.js`, `api/_shared/schedule.js`, `api/budgets`, `api/forecast`, `api/_shared/budgeting.js`, `api/payees`, `api/_shared/merchants.js`, the transaction and people changes, restore scoping in `api/_shared/backup.js`, and the new frontend views.

**Overall.** No cross-workspace access and no site-administrator path to financial data. One High (backups permanently failing after a normal restore sequence), five Medium, five Low, informational items. Verified sound: no 404/403 oracle on others' private bills; what-if is non-mutating; private merchants and private contacts refused on shared bills; plain members and viewers cannot change shared bills; the duplicate-merchant check compares only visible merchants; merchant suggestions and defaults respect visibility; budgets scope; restore preview counts are caller-scoped; audit entries carry no amounts; no `innerHTML`, no inline styles, merchant website never rendered as a link.

| ID | Severity | Finding | Fix (regression test in `api/test/security-b.test.js`) | Status |
|---|---|---|---|---|
| SEC-B1 | High | A replace restore removed a category a member's private bill used; recording the bill then made every backup fail (422) | Replace never removes directory records (categories, merchants); create-new carries merchants used by carried bills; recording refuses a missing category or merchant; invariants check bill and budget references | Fixed |
| SEC-B2 | Medium | The forecast added the incoming side of another member's private transfer bill to a shared account | Bills count only for viewers who may see entries on the bill's source account | Fixed |
| SEC-B3 | Medium | One enormous bill overflowed totals and broke bills, budgets and forecast for everyone | Bill amounts capped at 1e10 minor units and 500 bills per workspace; overflow contained per account and per budget | Fixed |
| SEC-B4 | Medium | Occurrence counting from ancient start dates or far-future query dates took seconds per request | Occurrences jump directly to the requested range; dates limited to years 1900–2200 | Fixed |
| SEC-B5 | Medium | The member quota ignored merchants, bills, budgets and their history; a viewer could fill the workspace | Quota counts merchants, bills and budgets and is enforced on their creation and edits | Fixed |
| SEC-B6 | Medium | Delete, record again, restore produced two live entries for one occurrence | Restore refuses a clashing occurrence; invariants enforce one live recording per occurrence | Fixed |
| SEC-B7 | Low/Medium | Bills on a deleted account stayed listed and recordable | Bills on deleted accounts are 404 and unlisted | Fixed |
| SEC-B8 | Low | Aliases of name-only merchants leaked through the people selector and search | Aliases shown and searched only for fully visible merchants | Fixed |
| SEC-B9 | Low | A private budget's other-currency count included other members' private accounts | Counted within the budget's scope only | Fixed |
| SEC-B10 | Low | A merchant's creator could keep using it after a grant was revoked | The creator shortcut applies only until the merchant's first use | Fixed |
| SEC-B11 | Low | Sharing a private merchant published its earlier history and a private account id | Others see history from the share onward without earlier values; account ids never recorded in history | Fixed |
| SEC-B12 | Info | Private transfer destination id exposed; deleted-vs-forbidden oracle; two-digit years misread; `http:` websites | Destination id masked; permission before existence; date range 1900–2200; `http:` kept deliberately | Fixed (http: accepted) |

Not verified by the review: real Azure Blob concurrency, browser rendering, the full test suite (run separately), Azure Functions timings.
