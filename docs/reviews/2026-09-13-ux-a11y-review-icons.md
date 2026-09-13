# UX/UI and accessibility review — contextual icons (BT-011-05), 2026-09-13

Independent, read-only review of the icon UI at `34f3dac` in headless Edge against the local dev server (fictional data; every non-GET API request was blocked by the probe, so nothing changed), as the owner and the site administrator, light and dark, Midnight and Amber palettes, 1280, 390 and 320 px.

| ID | Severity | Finding | Status |
|---|---|---|---|
| UXI-1 | Serious | Escape in an open icon list inside a dialog closed the whole dialog and lost the form (the dialog's capture listener ran first) | **Fixed**: `escapeBelongsToControl()` in `modal.js` leaves Escape to an open picker (by its toggle's `aria-expanded`) or combobox; Escape on an open picker's toggle closes the list. Tested (`app/test/icons.test.js`) and verified with a real key press in Edge (`--interact iconpickesc`: dialog open, list closed, focus on the toggle) |
| UXI-2 | Moderate | 53-entry list with no type-ahead or paging | **Fixed**: first-letter type-ahead (repeat to move to the next match) and PageUp/PageDown in the shared picker; tested |
| UXI-3 | Moderate | Workspace/My settings category cards very long; names only inside labels; no colour preview on icons | **Fixed**: one named, grouped row per category on a full-width card (name, colour, icon side by side); icon choices drawn in the category colour; tested |
| UXI-4 | Moderate | Refunds on the dashboard differed from income only by a hidden icon | **Fixed**: refunds and reversals carry screen-reader text beside the amount; tested |
| UXI-5 | Moderate | Site catalogue reloads dropped focus; checkboxes ungrouped | **Fixed**: focus returns to the same control by a stable key; the built-in list is a named fieldset and keeps its open state |
| UXI-6 | Minor | Type pickers lacked the word "icon"; uneven narrow grid | **Fixed**: "<type> icon" labels; wider grid columns |
| UXI-7 | Minor | Category colours are contrast-checked against white and the dark surfaces, not the page (#f6f7f9) or sunken (#eef0f4) surfaces | **Accepted for now**: category colours are drawn only on the checked surfaces; revisit if they are used on page or sunken backgrounds (changing the palette would alter stored defaults) |
| UXI-8 | Minor | Ambiguous artwork and labels | **Fixed**: book, coins, piggy bank, suitcase and mortgage redrawn; clock, bell, scale and globe relabelled Clock, Bell, Balance and Globe; the Transport merchant default is now Train |
| UXI-9 | Minor | Uneven icon coverage | **Fixed**: Uncategorized shows its tag icon; Bills account column and dashboard merchants show icons |
| UXI-10 | Minor | Clicking the picker's label does nothing | **Accepted** (naming is correct; the toggle is the control) |
| UXI-11 | Minor | No upload preview; rename field without a visible label | **Partly fixed**: visible "Name" label; a preview needs a safe client-side parse and is open |

**Verified sound (reviewer):** no icon exposed to assistive technology in any view; icon contrast 5.48–18.16:1 (category-coloured ≥ 3.09:1 on the surfaces used); consistent sizes and alignment; picker keyboard behaviour and names; no horizontal scrolling at 390 or 320 px; named checkboxes and file input in the catalogue.

**Still needs real assistive technology:** NVDA/JAWS/VoiceOver speech, forced colours, 200–400 % zoom and text spacing, touch; switched-off and custom icons with real data; the read-only Icons for types list for members and viewers.
