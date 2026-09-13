# Security review — contextual icons (BT-011-05), 2026-09-13

Independent, read-only review of commit `4bddb78` (icon catalogue, validated SVG upload, icon fields on records, workspace type icons, personal category icons, client registry). The reviewer changed no repository files; experiments ran against in-memory storage only.

**Result:** no Critical, High or Medium findings. No path from site administration or the icon route to workspace or financial data; outsiders and non-member site administrators get 404 for workspace type icons; nothing can be deleted.

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-I1 | Low | Category names such as `__proto__` or `constructor` reached `Object.prototype` in the default-icon lookup (a legacy category could be served and pinned with a non-string icon); the same lookup in `colors.initialDefault` made creating such a category a 500 | **Fixed**: own-property lookups in `icons.js` and `colors.js`; `effective()` returns only well-formed ids (`api/test/icons.test.js`, SEC-I1) |
| SEC-I2 | Low | The 100-icon limit counted retired icons, so the site could never upload again after 100 uploads | **Fixed**: only offered icons count; a separate cap (500) bounds everything stored; restoring past the limit is refused (tested) |
| SEC-I3 | Low | After a workspace switch the previous workspace's type icons stayed in the client registry until the new ones loaded (or indefinitely on failure) | **Fixed**: `setTypeIcons({})` runs synchronously when the icons slice is empty (`app/test/icons.test.js`, SEC-I3) |
| SEC-I4 | Low | The catalogue document had no size cap and its audit/history grow; every signed-in user downloads it on workspace switch | **Partly fixed**: writes are refused beyond 6 MB (never trimmed). Open: serve the site catalogue separately with an ETag, and partition catalogue audit/history (ADR-003) |
| SEC-I5 | Info | Validator leniencies with no stored effect: attributes on closing tags, non-ASCII whitespace in values, paths not starting with a move | **Tightened** (tested) |
| SEC-I6 | Info | Choosing and retiring an icon at the same moment can race; harmless because retired icons still draw | Accepted |
| SEC-I7 | Info | Personal category icons (like personal colours) are replaced without a change history | Open question for Terry: does BT-001-05 cover personal display preferences? |

**Verified sound:** the upload refuses script, style, links, entities, DOCTYPE/CDATA/comments/processing instructions, namespaced and event attributes and nested SVG; the size check precedes every regex (worst adversarial input about 36 ms); stored shapes are re-checked before serving and again in the browser; the client creates only allowed elements and attributes with `createElementNS` and never parses markup; catalogue changes are site-admin only; record icons follow each record's existing edit rule; merchants seen only through a shared entry show a generic icon; DELETE on `/api/icons` is 405.
