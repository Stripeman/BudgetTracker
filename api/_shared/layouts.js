'use strict';
// Design Gallery — BT-013: originally 20 workspace layout-theme concepts for Terry's review (design
// brief, 2026-09-16: "sharp, professional, clean, attractive, and highly functional interfaces — not
// one generic layout with different colors"). Terry (2026-09-17) cut 5 after reviewing real rendered
// screenshots: Cash-Flow Studio, Envelope Planner and Visual Finance all shared `cardStyle:
// 'filled-tint'`, which washes the whole card in `--accent-soft` — under the Solar or Amber palette
// that reads as a muddy tan/mustard ("yucky turd brown", his words) rather than a subtle tint; Timeline
// Finance and Adaptive Overview's icon rail rendered as an empty collapsed strip instead of visible nav
// items (a real rendering bug, not fixed — Terry asked for removal over a fix). 15 concepts remain.
//
// THIS FILE IS METADATA AND COMPOSITION PARAMETERS ONLY. It never holds or references real
// financial data. The Gallery (site-admin only: /api/design-gallery and the app's Gallery page)
// renders every concept below through the SAME reusable page-composition system the real
// application pages use — shared canonical fictional fixtures, shared components (money, icons,
// category colours, badges) — so what Terry reviews is built from real, reusable primitives, never
// a throwaway image. Nothing here is yet a selectable option on any real workspace: that stays the
// separate `layoutId` workspace setting (api/_shared/workspace-settings.js), which today offers only
// `classic`, the application's one existing implicit layout, until Terry chooses which of these 15
// to keep.
//
// COMPOSITION AXES (read by app/js/ui/gallery/compose.js, the shared renderer):
//   navStyle          'top' | 'rail' | 'sidebar' | 'sidebar-right' | 'command'
//   density           'spacious' | 'comfortable' | 'compact' | 'ultra-compact'
//   dashboardPattern  the Dashboard's hero composition — one of 12 genuinely distinct renderers
//                      shared across concepts that choose them (never per-concept duplicated code):
//                      'metric-grid' | 'chart-first' | 'table-first' | 'timeline' | 'card-stack' |
//                      'goal-progress' | 'merchant-feed' | 'envelope-grid' | 'command-console' |
//                      'split-focus' | 'story-flow' | 'adaptive'.
//                      BT-013-10 (Terry, 2026-09-20) adds 'reference-acru' and 'reference-ledgerfly';
//                      BT-013-11 (2026-09-20, expanding the same standard to the remaining 12 concepts
//                      once Terry approved the first three) adds 'reference-debtpayoff': unlike every
//                      pattern above, these are deliberately bespoke to a single concept each
//                      (`acru-overview`, `ledgerfly-forecast`, `goal-navigator`) rather than a reusable
//                      shared shape — built closely against one specific real reference image, per
//                      Terry's explicit instruction not to let the shared axis system dictate a
//                      reference-led design. They stay in this same axis slot (so the existing "every
//                      concept renders every required page" test still exercises them through the
//                      ordinary composition engine) without pretending to be reusable.
//   cardStyle         'flat-bordered' | 'soft-shadow' | 'outline-minimal' | 'filled-tint' | 'bordered-mono'
//   chartEmphasis     which shared accessible chart primitive leads: 'bars' | 'line' | 'mixed' | 'donut' |
//                      'area' ('donut'/'area' added with typeVoice below: a real circular-gauge and a
//                      filled-area chart primitive, app/js/ui/gallery/compose.js `radialGauge`/
//                      `areaChart`, matching the reference screenshots' "Financial health" ring and
//                      "Cash Forecast" area chart — never decoration alone, each pairs with the same
//                      sr-only figure-table/legend rule every other chart already follows)
//   typeVoice         the concept's typographic identity (Terry's "at least 15... deliberate
//                      typography" requirement, 2026-09-18): 'technical-mono' | 'editorial-serif' |
//                      'friendly-rounded' | 'bold-display' — a real, visible heading/figure font-
//                      family, weight and letter-spacing treatment (system font stacks only, no
//                      remote fonts, same CSP rule as the rest of the app), assigned by persona, never
//                      arbitrarily; see app/styles/gallery.css `[data-voice="…"]` rules. Reused across
//                      several concepts each (like every other axis) — real differentiation comes from
//                      the COMBINATION with each concept's own structural axes above, exactly as
//                      Terry's brief itself says ("changing a palette, font… alone does not count").
//   transactionsPattern / billsPattern / budgetPattern / accountsPattern / settingsPattern
//                      genuinely distinct secondary-page compositions (review, 2026-09-18) — see the
//                      dedicated comment above their axis constants near the bottom of this file.
//   accentLight / accentDark
//                      each concept's own colour IDENTITY (review, 2026-09-19: before this, every
//                      concept shared only the site's own theme tokens — explicitly documented as
//                      deliberate in gallery.css's own former header comment, and a real gap against
//                      Terry's "deliberate... color" requirement). A hex pair — one tuned for light
//                      mode, one for dark — applied ONLY inside that concept's own `.gframe` (never
//                      the surrounding application chrome, never a real workspace) as `--g-accent`,
//                      read by app/js/ui/gallery/compose.js/gallery.css wherever a concept-specific
//                      accent belongs (active nav, meters, chart lines/fills, the bold-display rule,
//                      the filled-tint card background). Every one of the 15 pairs is independently
//                      verified (app/test/gallerypatterns.test.js) at >=3:1 contrast against the
//                      real light surface (#ffffff) and dark surface (#141a24) respectively — the
//                      same WCAG non-text-contrast bar this repository already holds hairline
//                      borders and focus rings to elsewhere. This is genuinely additive to, never a
//                      replacement for, the palette/mode picker every concept still also honours.
//
// `fidelity: 'flagship'` marks the concepts hand-tuned beyond the shared responsive template with
// bespoke content (see docs/REQUIREMENTS.md BT-013 for exactly which pages, per concept, and
// PROJECT_STATE.md Checkpoint S for the honest fully-realized-vs-inherited accounting). Every
// concept gets a genuinely composed Dashboard (one of the twelve patterns above, never a recolored
// copy) AND its own combination of secondary-page patterns above — real structural variety on
// Transactions, Bills, Budget, Accounts/Merchants, Shared expenses and Trips, not one shared
// template for all fifteen. Only the read-only Settings summary still uses one of two flat/grouped
// templates per settingsPattern value, since Terry's brief asked for a label-value read-only list
// there, not the same page-pattern variety it asked of the others. `recommended: true` marks this
// session's top-10 recommendation for Terry (see the handoff report); it changes nothing
// server-side and is shown in the Gallery only as a label.
//
// REQUIRED_PAGES is the minimum set Terry's brief names for every concept's review deliverable.
// 'accounts' added (review, 2026-09-18): the design brief explicitly names "Accounts/Merchants" as
// one of the required coordinated views per concept; it was missing from the Gallery entirely
// before this fix. 'trips' stays too — already built, and removing a working page would be an
// unrelated regression, even though the brief itself does not separately name it.
// BT-013-14 (2026-09-20): 'settings' split into 'mysettings' and 'worksettings', preserving the real
// app's own distinction (My Settings applies only to the viewer; Workspace Settings applies to
// everyone in the workspace, BT-017) — Terry named both explicitly as required pages, never one
// combined page standing in for both.
const REQUIRED_PAGES = Object.freeze(['dashboard', 'transactions', 'bills', 'budget', 'accounts', 'shared', 'trips', 'mysettings', 'worksettings']);

// BT-013-15 (2026-09-20, Terry): two further pages his own page-purpose table names explicitly —
// "Merchants" (split out from the combined Accounts/Merchants page) and "Debt/loan detail" — but
// ONLY for the three flagship reference-matched designs this increment focuses on
// (`acru-overview`, `finexa-budget`, `ledgerfly-forecast`), never added to `REQUIRED_PAGES` itself.
// Terry's own instruction was to "pause expansion" of the other twelve concepts while these three are
// brought to standard, not to retrofit two more pages onto all fifteen — so this stays a per-concept
// `extraPages` list (empty for every concept that does not declare it) rather than a change to the
// one global list every concept is tested against. A concept that lists a page here MUST also declare
// the matching `<page>Pattern` field (e.g. `merchantsPattern`), exactly like every required page's own
// pattern field.
const EXTRA_PAGES = Object.freeze(['merchants', 'debt']);

// The one real, selectable layout today (workspace setting `layoutId`, BT-011-07/BT-013): today's
// existing implicit application layout, kept exactly as it behaves now. Nothing in CONCEPTS below is
// in this list — that is the deliberate boundary between "under review in the Gallery" and "a real
// workspace may choose this".
const REAL_LAYOUT_OPTIONS = Object.freeze([{ value: 'classic', label: 'Classic (current)' }]);
const REAL_DEFAULT_LAYOUT_ID = 'classic';

function c(entry) { return Object.freeze(entry); }

// BT-013-09 (2026-09-19): every concept below is a genuine redesign — new name, new positioning,
// and a new combination across the (now expanded) composition axes above, replacing the set Terry
// explicitly rejected. `id`s are kept stable (see the comment above the axis constants).
const CONCEPTS = Object.freeze([
  c({
    id: 'executive-ledger', name: 'Ledger Command',
    tagline: 'A running strip of the figures that matter, over the real transaction ledger.',
    direction: 'A left sidebar for instant orientation, a horizontal strip of key figures at the top of the dashboard, and a genuine two-column layout beneath it: the real ledger dominant on the left, a slim "needs attention"/accounts rail on the right — nothing important is ever more than a glance away. BT-013-12 (2026-09-20): polished with real meta context on every KPI figure (not a bare number) and the coordinated two-column ledger layout, still a single-purpose composition built for this concept, not a recombination of unrelated templates.',
    distinct: 'Ledger-strip dashboard: a genuinely new hero combining a scannable row of KPI figures with the real ledger table beneath it, never a bare table alone and never a grid of equal-weight cards. The KPI strip and the ledger/rail layout below are one coordinated composition, not two unrelated pieces.',
    audience: 'Owners and managers who want authority and completeness: every key figure at a glance, then the real ledger, before anything decorative.',
    strengths: ['The KPI strip answers "how am I doing" in one glance, before scrolling to the ledger.', 'Sidebar orientation means no second click to see what exists.', 'Scans fast for someone who already knows what they are looking for.'],
    tradeoffs: ['Busier first impression; not reassuring for someone anxious about money.', 'The KPI strip scrolls horizontally on narrow screens and needs a visible scroll affordance.'],
    accessibilityNotes: ['The KPI strip is a real, keyboard-reachable scroll region with visible focus, never mouse-only.', 'Sidebar order matches reading order for screen readers (nav before main).'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'ledger-strip', cardStyle: 'ribbon', chartEmphasis: 'bars', typeVoice: 'technical-mono',
    transactionsPattern: 'dense-table', billsPattern: 'compact-table', budgetPattern: 'list-progress', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    accentLight: '#1a4d7a', accentDark: '#5aa3e8',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'modern-banking', name: 'Everyday Banking',
    tagline: 'An asymmetric mosaic of what matters most, sized by importance.',
    direction: 'A rounded, segmented tab bar and a mosaic dashboard: one large "your money" tile leads, with smaller tiles for budget, bills and shared balance around it, and recent activity spanning the width beneath. BT-013-12 (2026-09-20): the large tile now carries a real day-by-day net-movement sparkline, and every smaller tile\'s figure is derived from the same fixtures, not a hand-typed placeholder.',
    distinct: 'Mosaic dashboard: real visual hierarchy through TILE SIZE (one large, several smaller, one wide), the opposite structural idea from a uniform grid or a single hero panel — nothing here is equal-weight by accident.',
    audience: 'Everyday members who want their bank app\'s familiarity: the one figure that matters biggest, detail on request.',
    strengths: ['Tile size itself communicates priority — no reading required to know what matters most.', 'Scales gracefully to any number of accounts without the mosaic losing its shape.', 'Segmented tab bar is immediately familiar from mobile banking apps.'],
    tradeoffs: ['Asymmetric layouts need real design discipline to avoid feeling arbitrary — the big tile is always the same figure, never chosen at random.', 'Reflows to a single column on mobile, losing the mosaic effect there by necessity.'],
    accessibilityNotes: ['Tile size is a visual affordance only; DOM and reading order always put the most important tile first regardless of its visual size.', 'Reduced motion collapses any tile entrance transition to none.'],
    density: 'comfortable', navStyle: 'tabs', dashboardPattern: 'mosaic', cardStyle: 'soft-shadow', chartEmphasis: 'mixed', typeVoice: 'friendly-rounded',
    transactionsPattern: 'card-list', billsPattern: 'grouped-status', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'card-grid',
    accentLight: '#7a1a5c', accentDark: '#e85aaf',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'financial-command-center', name: 'Ops Console',
    tagline: 'One unified, urgency-sorted feed instead of four separate panels.',
    direction: 'An icon-only rail, ultra-compact spacing and tightly tracked uppercase labels, with a single dashboard feed that sorts every alert and bill together by real urgency: Now, Soon, Later. BT-013-12 (2026-09-20): a slim top KPI ribbon (real Now/Soon/Later counts) now anchors the page, and the feed itself is grouped into real labelled sections instead of one flat list with inline badges.',
    distinct: 'Inbox dashboard: ONE unified, urgency-ordered list combining alerts and bills, replacing the earlier four-fixed-panel console — the order itself is the entire point, not a fixed layout of equal panels. Now genuinely sectioned (Now/Soon/Later headers) rather than inline badges alone.',
    audience: 'Power users running several accounts, budgets and a shared-expense group who want the single most urgent thing first, always.',
    strengths: ['Nothing competes for attention with something more urgent above it — real triage, not four equally-loud panels.', 'Icon rail and condensed labels reclaim width for the feed itself.', 'Scales cleanly whether there are two urgent items or twelve.'],
    tradeoffs: ['Icon-only rail needs strong tooltips/labels for new users and screen-reader users.', 'Ultra-compact density is the wrong choice for anyone who prefers spacious layouts — never the default.'],
    accessibilityNotes: ['Icon rail items keep full text labels for assistive technology even though they are visually hidden.', 'The feed is a single ordered list (ul/li) so its urgency order is preserved for assistive technology, not just visually.'],
    density: 'ultra-compact', navStyle: 'rail', dashboardPattern: 'inbox', cardStyle: 'outline-minimal', chartEmphasis: 'bars', typeVoice: 'condensed-utility',
    transactionsPattern: 'dense-table', billsPattern: 'kanban-columns', budgetPattern: 'bar-comparison', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'settlement-focus', tripsPattern: 'list',
    accentLight: '#7a3d0a', accentDark: '#e89a3d',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'calm-budget', name: 'Morning Briefing',
    tagline: 'One headline figure, three plain sentences, and today\'s short list.',
    direction: 'A single wide reading column and a genuine daily briefing: one large headline figure, a couple of plain-language sentences, and a short real list of what actually needs attention today. BT-013-12 (2026-09-20): a soft, warm card treatment and a real date line now frame the briefing, keeping its own already-wired "Add expense" action unchanged.',
    distinct: 'Briefing dashboard: a real structured priorities list under one large headline figure — distinct from a prose-only narrative (nothing else here reads as a short story) and from any card grid.',
    audience: 'People who find budgeting stressful and want the single most important number first, then only what genuinely needs their attention today.',
    strengths: ['Lowest cognitive load of any concept — one number, then a short real list, nothing else competing.', 'Reads well on mobile without any layout change.', 'The priorities list is genuinely actionable, not just decorative prose.'],
    tradeoffs: ['Low information density; a power user will find it slow to get an overview.', 'Depends on the priorities list staying short and genuinely relevant — a long list would defeat the whole idea.'],
    accessibilityNotes: ['Single column removes any reading-order ambiguity.', 'The priorities list is a real ul/li, each item pairing an icon with full text, never colour or the icon alone.'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'briefing', cardStyle: 'layered', chartEmphasis: 'line', typeVoice: 'friendly-rounded',
    transactionsPattern: 'flat-list', billsPattern: 'timeline', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'card-grid',
    accentLight: '#0a5c3d', accentDark: '#3de89a',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'precision-grid', name: 'Spreadsheet Mode',
    tagline: 'Compact tables, sharp alignment and rapid scanning.',
    direction: 'An icon rail, compact density and a monospace-leaning table aesthetic: sharp borders, right-aligned figures, no rounded cards. BT-013-12 (2026-09-20): the dashboard\'s hero is now a real accounts x metrics data grid (balance and spend-this-period per account) — a genuine spreadsheet-style report, not just a bare transaction list — with the ledger beneath it.',
    distinct: 'Bordered-mono card style is unique to this concept: hairline borders, square corners, tabular figures — a deliberately unrounded, unshadowed visual language, kept exactly as sharp on every page, with tight condensed-utility labels throughout.',
    audience: 'Spreadsheet-minded users who want the fastest possible scanning of exact figures.',
    strengths: ['Fastest figure-to-figure scanning of any concept.', 'Alignment and monospaced numerals reduce misreading amounts.', 'Minimal chrome maximises rows visible.'],
    tradeoffs: ['Can feel cold or "spreadsheet-like" to a casual user.', 'Sharp corners and hairlines need care to stay above 3:1 non-text contrast.'],
    accessibilityNotes: ['Hairline borders verified at >=3:1 against surface in every palette/mode (same check as the login page\'s preview cards).', 'Table headers keep scope="col"/"row" regardless of density.'],
    density: 'compact', navStyle: 'rail', dashboardPattern: 'table-first', cardStyle: 'bordered-mono', chartEmphasis: 'bars', typeVoice: 'condensed-utility',
    transactionsPattern: 'dense-table', billsPattern: 'compact-table', budgetPattern: 'list-progress', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    accentLight: '#4a2d7a', accentDark: '#a377e8',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'wealth-overview', name: 'Net Worth Atlas',
    tagline: 'Polished net-worth, assets, liabilities and trend presentation.',
    direction: 'A sidebar for orientation, an editorial serif voice, and a chart-first dashboard whose hero is a filled net-position trend area, with a real Assets/Liabilities breakdown (BT-013-12, 2026-09-20: every real account, split by whether it adds to or subtracts from net worth) broken out beneath it.',
    distinct: 'Chart-first dashboard with the filled AREA chart emphasising the TREND over time, rather than a single point-in-time figure — the only concept whose hero panel is explicitly historical.',
    audience: 'Owners tracking net worth and long-term position across several accounts and a loan.',
    strengths: ['Trend is immediately visible, not just today\'s number.', 'Assets vs liabilities breakdown answers "what do I actually have" at a glance.', 'Sidebar keeps every section reachable while looking at the trend.'],
    tradeoffs: ['A new workspace with little history has a flat, unhelpful trend line at first.', 'Chart-first layouts need the surrounding numeric table for anyone the chart does not reach.'],
    accessibilityNotes: ['Every chart pairs with the existing sr-only figure table pattern (from the Usage page); the filled area is never the only source of the numbers.', 'Line colour kept distinguishable from category colours already in use, never relying on hue alone (also different dash pattern per series).'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'chart-first', cardStyle: 'layered', chartEmphasis: 'area', typeVoice: 'editorial-serif',
    transactionsPattern: 'grouped-by-date', billsPattern: 'timeline', budgetPattern: 'bar-comparison', accountsPattern: 'grouped-by-type', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'timeline',
    accentLight: '#8a5a0a', accentDark: '#e8b83d',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'household-hub', name: 'Family Circle',
    tagline: 'Shared household planning, responsibilities and bills.',
    direction: 'A spacious top-nav layout with ribbon-accented cards whose dashboard leads with a stack of "what the household needs" cards: shared bills due, who paid what, and the shared balance. BT-013-11 (2026-09-20): its Shared expenses page is now a bespoke, reference-led composition — closely following a real reference UI kit\'s own group-expense screens (`.local/refcheck/r04.png`), not the shared axis vocabulary: a bold total-bill figure, coloured member avatars ordered by who is owed, and a real expense list styled as individual receipt cards rather than a plain table row.',
    distinct: 'Card-stack dashboard, but household-scoped (shared bills, shared balance, members) rather than personal accounts, with each card carrying its own coloured top ribbon for quick visual grouping. Its Shared expenses page (`sharedPattern: \'reference-groupsplit\'`, `app/js/ui/gallery/compose.js` `sharedReferenceGroupsplit`) is a second, independently bespoke composition, with its own dedicated `.ggroupsplit-*` CSS.',
    audience: 'Households, couples and roommates who split bills and want shared context, not personal net worth.',
    strengths: ['Puts shared responsibility front and centre for multi-person workspaces.', 'Ribbon accents make it easy to visually group "shared" cards at a glance.', 'Spacious top-nav is approachable for less financially fluent household members.', 'The Shared expenses page makes "who is owed and who owes" the very first thing seen, before any individual expense.'],
    tradeoffs: ['Less useful for a single-person personal workspace (not its audience).', 'Needs Shared expenses turned on to show its strongest card.'],
    accessibilityNotes: ['Household member list never shows another member\'s private account information (structural composition only — the underlying authorization is unchanged by layout).', 'Cards reflow to one column at 320px with no truncation of names.', 'Every member avatar on the Shared expenses page pairs with their real visible name, never an avatar alone.'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'card-stack', cardStyle: 'ribbon', chartEmphasis: 'bars', typeVoice: 'friendly-rounded',
    transactionsPattern: 'card-list', billsPattern: 'grouped-status', budgetPattern: 'envelope-grid', accountsPattern: 'grouped-by-type', settingsPattern: 'flat-list', sharedPattern: 'reference-groupsplit', tripsPattern: 'card-grid',
    accentLight: '#7a0a2d', accentDark: '#e8477a',
    fidelity: 'flagship', recommended: false,
  }),
  c({
    id: 'travel-ledger', name: 'Journey Ledger',
    tagline: 'Trips, multiple currencies, shared expenses and settlement emphasis.',
    direction: 'A top-nav, editorial-voice layout whose dashboard leads with a dominant "Active trip" hero (real trip progress from the trip itself), with balances and shared-expense settlement suggestions paired beneath it, so a trip in progress is never a click away. BT-013-12 (2026-09-20): separated out of the old shared `split-focus` pattern into its own bespoke `trip-focus` composition — no longer sharing one generic panel structure with Filter Desk\'s unrelated filters-and-comparisons identity.',
    distinct: 'A genuinely bespoke Dashboard renderer (`trip-focus`, `app/js/ui/gallery/compose.js` `heroTripFocus`) built specifically for this concept\'s own trip-and-settlement identity: a dominant trip hero, not two co-equal panels sharing a generic split-focus shape with an unrelated concept.',
    audience: 'Groups travelling together who split costs across currencies and need to see who owes whom without leaving the dashboard.',
    strengths: ['Trip and settlement context is always visible, not buried in a separate page.', 'Multi-currency figures shown with their original amount and rate, matching the app\'s existing invariant.', 'Natural home for the "fewest payments" settlement suggestions.'],
    tradeoffs: ['Less useful outside a group/trip workspace.', 'Two-panel split needs to stack cleanly on mobile (verified single-column at 390px).'],
    accessibilityNotes: ['Currency figures always paired with their code, never a bare symbol.', 'Split-panel layout uses a single DOM reading order (balances, then trip) so it matches visually at every width.'],
    density: 'comfortable', navStyle: 'top', dashboardPattern: 'trip-focus', cardStyle: 'ribbon', chartEmphasis: 'line', typeVoice: 'editorial-serif',
    transactionsPattern: 'grouped-by-date', billsPattern: 'timeline', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'timeline',
    accentLight: '#0a6a7a', accentDark: '#3dd6e8',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'ledgerfly-forecast', name: 'Executive Forecast',
    tagline: 'A compact executive overview anchored by a dominant cash-forecast chart and a real scenario panel.',
    direction: 'BT-013-10 (Terry, 2026-09-20): a reference-led composition, not an axis recombination — closely follows the Ledgerfly reference\'s whole Executive Overview page (`.local/refcheck/r05.png`, extracted from docs/BudgetTracker-references.html). A compact, professional dark sidebar with a clear active state; a restrained header; a KPI strip of four figures with one deliberately emphasised (Total balance, shown on a dark navy card, matching the reference\'s own emphasis treatment); a dominant filled cash-forecast chart with a readable legend, anchoring the page; a right-hand column of real BudgetTracker breakdowns (spending by category, primary cost drivers by merchant); a scenario panel stating the workspace\'s own already-real Expected/Cautious/Hopeful forecast figures (never a fabricated "run simulation" the Gallery cannot actually execute) and a genuine upcoming-obligation card (the largest unpaid bill). Navy/indigo emphasis throughout, balanced information density.',
    distinct: 'A genuinely bespoke Dashboard renderer (`reference-ledgerfly`, app/js/ui/gallery/compose.js `heroReferenceLedgerfly`) built to match one specific reference\'s composition, not assembled from the shared axis vocabulary — its own dedicated CSS (`.gledgerfly-*`, app/styles/gallery.css) and a new filled-trend chart primitive kept structurally distinct from the existing `chart--area` primitive (so `wealth-overview` stays the sole concept whose `chartEmphasis` is `area`, per the existing test), never a recolour of an existing hero pattern.',
    audience: 'Owners and managers who want an executive-style snapshot: cash position, burn, runway and a forward-looking forecast together, in a genuinely polished, reference-quality composition.',
    strengths: ['The KPI strip states cash position, burn and runway together, before any chart — an at-a-glance executive read.', 'The dominant forecast chart and its scenario panel share the same real Expected/Cautious/Hopeful figures already used elsewhere in the Gallery, never a second invented forecast.', 'The right column\'s spending breakdown and top cost drivers give real depth without leaving the page.'],
    tradeoffs: ['The bespoke composition is deliberately NOT reusable by other concepts the way the shared axis patterns are — by design, matching the same reference-led exception already established for the ACRU and Finexa concepts.', 'A workspace with very little transaction history shows a flatter forecast and a less meaningful runway figure at first.'],
    accessibilityNotes: ['The forecast chart pairs with the same sr-only figure-table rule every other chart in this Gallery already uses.', 'The KPI strip states every figure as real visible text, never colour or card emphasis alone.', 'Sidebar order matches reading order for screen readers (nav before main), unchanged from the existing sidebar nav style.'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'reference-ledgerfly', cardStyle: 'soft-shadow', chartEmphasis: 'line', typeVoice: 'condensed-utility',
    // BT-013-15 (2026-09-20): every required financial page now carries the SAME "restrained sidebar,
    // KPI strip, dominant analytical chart" identity `reference-ledgerfly` established on the
    // Dashboard, plus the two new pages Terry's table names — not the shared axis vocabulary.
    transactionsPattern: 'reference-ledgerfly', billsPattern: 'reference-ledgerfly', budgetPattern: 'reference-ledgerfly', accountsPattern: 'reference-ledgerfly', settingsPattern: 'flat-list', sharedPattern: 'reference-ledgerfly', tripsPattern: 'reference-ledgerfly',
    extraPages: ['merchants', 'debt'], merchantsPattern: 'reference-ledgerfly', debtPattern: 'reference-ledgerfly',
    accentLight: '#1a2a7a', accentDark: '#8fa0f5',
    fidelity: 'flagship', recommended: false,
  }),
  c({
    id: 'analyst-workspace', name: 'Filter Desk',
    tagline: 'Filters, comparisons, reporting and data-density emphasis.',
    direction: 'A compact, condensed-label layout with a persistent right-hand filter rail beside a real category report table, so filtering never navigates away from the data. BT-013-12 (2026-09-20): now the sole holder of the `split-focus` pattern (Journey Ledger has its own bespoke composition) — the right panel is a real spent/planned/available report per category, not a plain balances list.',
    distinct: 'The only concept with `sidebar-right`: a persistent secondary panel for filters rather than navigation, paired with a real dense category report and tight condensed-utility labels throughout.',
    audience: 'Analysts and detail-oriented owners who filter, compare periods and export rather than browse.',
    strengths: ['Filters stay visible while scanning results — no round trip to a separate filter page.', 'Table-first hero keeps real figures central.', 'Naturally extends to side-by-side period comparison.'],
    tradeoffs: ['Right-hand rail costs width on narrower desktop screens; collapses to a drawer under 1024px.', 'Not the friendliest first impression for a casual user.'],
    accessibilityNotes: ['The filter rail is reachable by keyboard before the results in tab order when open, and is a labelled region either way.', 'Collapsing the rail to a drawer keeps focus management (opens with focus inside, closes returning focus to its toggle) — the same pattern as the command picker\'s panel.'],
    density: 'compact', navStyle: 'sidebar-right', dashboardPattern: 'split-focus', cardStyle: 'outline-minimal', chartEmphasis: 'bars', typeVoice: 'condensed-utility',
    transactionsPattern: 'filter-first', billsPattern: 'compact-table', budgetPattern: 'bar-comparison', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    accentLight: '#5c2d7a', accentDark: '#c277e8',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'goal-navigator', name: 'Milestone Path',
    tagline: 'Savings goals, debt payoff and progress milestones.',
    direction: 'BT-013-11 (2026-09-20): now a bespoke, reference-led Dashboard — closely following a real debt-payoff app\'s own "Payoff Plan" screen (`.local/refcheck/r06.png`), not the shared axis vocabulary: a bold "payments until debt-free" hero stat with a projected freedom date, a real per-debt payment-order list with progress bars, and two circular payoff-percentage gauges — replacing the earlier generic goal-progress template with one built for this exact page.',
    distinct: 'A genuinely bespoke Dashboard renderer (`reference-debtpayoff`, `app/js/ui/gallery/compose.js` `heroReferenceDebtpayoff`) built to match one specific reference\'s composition, not assembled from the shared axis vocabulary — its own dedicated `.gpayoff-*` CSS, never a recolour of goal-progress\'s two full-width cards. The hero answers "when am I debt-free", not "what is my balance" — a motivational framing distinct from every balance-first, table-first or ring-cluster concept.',
    audience: 'People actively paying down debt who want to see a real projected payoff date and payment order, not just today\'s balances.',
    strengths: ['A single "payments until debt-free" figure and date answer the one question this concept exists for, before any other detail.', 'The payment-order list shows every real debt account\'s own progress, not a single number standing in for all of them.', 'Naturally extends to the forecast\'s "what-if" scenarios (pay more, pay less) already built.'],
    tradeoffs: ['Less useful for someone with no active debt — degrades to a plain balance view when none exists.', 'The projected payoff date assumes a steady monthly payment, disclosed plainly as an illustrative assumption rather than a guarantee.'],
    accessibilityNotes: ['Every progress meter and gauge keeps the existing figure-as-text rule; the real percentage and amount are always stated in words, never colour or the arc alone.', 'No animated counters — reduced motion is respected identically to every other concept.'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'reference-debtpayoff', cardStyle: 'ribbon', chartEmphasis: 'donut', typeVoice: 'bold-display',
    transactionsPattern: 'flat-list', billsPattern: 'grouped-status', budgetPattern: 'bar-comparison', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'card-grid',
    accentLight: '#8a2d0a', accentDark: '#e87a3d',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'merchant-insights', name: 'Spend Radar',
    tagline: 'Merchant activity, patterns, subscriptions and spending history.',
    direction: 'A sidebar layout whose dashboard hero is a feed of merchant activity: recent and recurring merchants, subscription-type bills, and spend trend per merchant. BT-013-11 (2026-09-20): its Transactions page is now a bespoke, reference-led composition — a calm, complete ledger closely following a real reference screenshot\'s whole page (`.local/refcheck/r03.png`), not the shared axis vocabulary: a plain vertical sidebar, a big "All entries" heading with a real period label, three always-visible entry actions, and a clean row-per-entry table with a colour-coded, plain-language type pill (Income/Expense/Transfer) beside every amount.',
    distinct: 'Merchant-feed dashboard pattern: the only concept whose hero organises by WHO money went to, rather than by account, category or date. Its Transactions page (`transactionsPattern: \'reference-monsy\'`, `app/js/ui/gallery/compose.js` `txnReferenceMonsy`) is a second, independently bespoke composition, with its own dedicated `.gmonsy-*` CSS.',
    audience: 'Users who want to notice forgotten subscriptions and recurring merchants and understand spending patterns per merchant — and, on the Transactions page, anyone who wants the calmest, most complete single ledger view of every entry.',
    strengths: ['Surfaces recurring/subscription merchants where they are easy to miss elsewhere.', 'Uses the existing managed-merchant directory and its icons directly, never free text.', 'Natural home to notice a merchant whose spending is rising.', 'The Transactions page states a plain-language type for every entry, not just a signed amount.'],
    tradeoffs: ['Less useful for a workspace with few distinct merchants.', 'Needs merchants to be well-maintained (closed/reopened correctly) to stay accurate — inherits the existing merchant lifecycle rules unchanged.'],
    accessibilityNotes: ['Every merchant row keeps its managed icon plus visible name (icon never the only identifier).', 'Feed is a real list (ul/li), ordered and readable by assistive technology in the same order as sighted users see it.', 'Every type pill on the Transactions page is real text, never colour alone.'],
    density: 'comfortable', navStyle: 'rail', dashboardPattern: 'merchant-feed', cardStyle: 'flat-bordered', chartEmphasis: 'bars', typeVoice: 'condensed-utility',
    transactionsPattern: 'reference-monsy', billsPattern: 'grouped-status', budgetPattern: 'envelope-grid', accountsPattern: 'grouped-by-type', settingsPattern: 'flat-list', sharedPattern: 'ledger-table', tripsPattern: 'card-grid',
    accentLight: '#2d6a1a', accentDark: '#7ae83d',
    fidelity: 'flagship', recommended: false,
  }),
  c({
    id: 'finexa-budget', name: 'Budget Workspace',
    tagline: 'A purpose-built budget workspace: utilization at a glance, bills tracked, categories broken out.',
    direction: 'BT-013-10 (Terry, 2026-09-20): a reference-led composition for the BUDGET page specifically, not an axis recombination — closely follows the Finexa reference\'s whole Budgets page (`.local/refcheck/r02.png`, extracted from docs/BudgetTracker-references.html). A polished pill-style top navigation with a clear active state; a bold page title and subtitle over a primary "+ Add budget line" action; a large planned-vs-spent utilization chart paired with an upcoming-bills summary; four category cards each combining a spent figure, a utilization percentage, a genuinely different small chart, a remaining figure and a status pill; a cohesive purple/lavender palette on clean neutral surfaces.',
    distinct: 'A genuinely bespoke Budget-page renderer (`reference-finexa`, app/js/ui/gallery/compose.js `budgetReferenceFinexa`) built to match one specific reference\'s composition, not assembled from the shared budgetPattern vocabulary — its own dedicated CSS (`.gfinexa-*`, app/styles/gallery.css) and two new shared chart primitives (a two-series comparison bar chart and a filled percentage dial), never a recolour of an existing budget pattern. Its own Dashboard still uses the existing ring-cluster hero (several comparative gauges), fitting a workspace this budget-focused without inventing a second unrelated composition.',
    audience: 'Owners actively managing a monthly budget who want utilization, bills and category-level detail together on one page, in a genuinely polished, reference-quality composition.',
    strengths: ['The utilization chart and bills summary read as one coordinated top section, not two unrelated cards.', 'Each category card genuinely differs in its chart type, mirroring how differently categories behave (steady vs. spiking vs. nearly exhausted).', 'Status pills state plainly, in words, whether a category is on track, almost reached or over — never colour alone.'],
    tradeoffs: ['The bespoke Budget composition is deliberately NOT reusable by other concepts\' budgetPattern the way the shared axis patterns are — by design, matching the same reference-led exception already established for the ACRU-inspired Dashboard.', 'A workspace with very few budget lines shows fewer than four category cards, gracefully.'],
    accessibilityNotes: ['The utilization chart pairs with the same sr-only figure-table rule every other chart in this Gallery already uses.', 'Each category card states its spent amount, percentage, remaining amount and status as real visible text beside its chart, never colour or the chart alone.', 'The pill nav keeps a visible focus ring and current-page state (aria-current) unchanged from the existing tabs nav style.'],
    density: 'comfortable', navStyle: 'tabs', dashboardPattern: 'ring-cluster', cardStyle: 'soft-shadow', chartEmphasis: 'mixed', typeVoice: 'bold-display',
    transactionsPattern: 'card-list', billsPattern: 'kanban-columns', budgetPattern: 'reference-finexa', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'card-grid',
    accentLight: '#6a1a9e', accentDark: '#c98ef0',
    // recommended stays false here, matching the concept this replaced (Metric Rings) — `recommended`
    // is this session's own pre-BT-013-10 top-10 label (see the comment above CONCEPTS), a bookkeeping
    // fact this checkpoint has no reason to relitigate; flagship fidelity reflects the real bespoke
    // reference-led build this checkpoint actually did.
    fidelity: 'flagship', recommended: false,
  }),
  c({
    id: 'acru-overview', name: 'Financial Overview',
    tagline: 'A central cash-flow chart anchored by a coordinated sidebar, stat rail and account summary.',
    direction: 'BT-013-10 (Terry, 2026-09-20): a reference-led composition, not an axis recombination — closely follows the ACRU reference\'s whole page (`.local/refcheck/r01.png`, extracted from docs/BudgetTracker-references.html), never just one borrowed element. A clean sidebar with a clear active state; a restrained utility header (search, notifications, settings, an "Add entry" primary action); a large central cash-flow chart anchoring the page with income/expenses/net figures placed deliberately beside it; a coordinated right-hand column of real BudgetTracker content (accounts, upcoming bills) replacing the reference\'s bank-card/promo area entirely, per Terry\'s explicit substitution rule; lower panels for spending distribution, overall budget health and this month\'s budget progress. Rounded surfaces, soft shadows, generous spacing.',
    distinct: 'A genuinely bespoke Dashboard renderer (`reference-acru`, app/js/ui/gallery/compose.js `heroReferenceAcru`) built to match one specific reference\'s composition, not assembled from the shared axis vocabulary — its own dedicated CSS (`.gacru-*`, app/styles/gallery.css), never a recolour of an existing hero pattern.',
    audience: 'Owners and managers who want one glance at cash flow, accounts and bills together, in a genuinely polished, reference-quality composition.',
    strengths: ['The hero chart, stat rail and right column read as one coordinated composition, not separate cards competing for attention.', 'Spending distribution, budget health and progress panels below give real depth without leaving the page.', 'Sidebar orientation keeps every section one click away.'],
    tradeoffs: ['The bespoke composition is deliberately NOT reusable by other concepts the way the shared axis patterns are — by design, since Terry\'s own instruction was that the existing template system must not dictate this design.', 'A new workspace with little transaction history has a flatter chart at first.'],
    accessibilityNotes: ['The hero chart pairs with the same sr-only figure-table rule every other chart in this Gallery already uses.', 'The spending-distribution segmented bar states each category and its percentage in real text beside the bar, never colour alone.', 'Sidebar order matches reading order for screen readers (nav before main), unchanged from the existing sidebar nav style.'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'reference-acru', cardStyle: 'soft-shadow', chartEmphasis: 'bars', typeVoice: 'technical-mono',
    transactionsPattern: 'dense-table', billsPattern: 'compact-table', budgetPattern: 'list-progress', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    accentLight: '#4a7a0a', accentDark: '#a3e85a',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'focus-mode', name: 'One Thing Mode',
    tagline: 'Simplified daily financial actions with deeper details on demand.',
    direction: 'An almost-nav-less top bar (one primary action, one "more" link) and a spacious dashboard reduced to a single, large, centred focal card — the single most relevant thing right now — with every other section one click away, never removed. BT-013-12 (2026-09-20): rebuilt as one deliberate centred card (not a top-aligned paragraph stack), keeping its already-wired "Add expense" action unchanged.',
    distinct: 'The most reduced navigation of any concept (command-adjacent minimalism without requiring keyboard command usage) — a deliberate "do the one thing" framing rather than an overview.',
    audience: 'Users who open the app to do one quick thing (add an expense, check "am I okay today") and do not want a dashboard to read.',
    strengths: ['Fastest path to the single most common action (Add expense).', 'Lowest chance of feeling overwhelmed on open.', 'Every section still fully reachable — nothing is actually removed, only de-emphasised.'],
    tradeoffs: ['Weakest overview of any concept — a poor fit for anyone who wants a dashboard.', 'Needs a clear, discoverable way to the rest of the app (a visible "More" / full nav toggle, always present, never hidden behind a gesture).'],
    accessibilityNotes: ['The "more" control is a real, labelled, always-present link/button, never a swipe-only affordance.', 'Reduced navigation never reduces the number of landmarks below one nav + one main.'],
    density: 'spacious', navStyle: 'command', dashboardPattern: 'story-flow', cardStyle: 'layered', chartEmphasis: 'line', typeVoice: 'friendly-rounded',
    transactionsPattern: 'flat-list', billsPattern: 'timeline', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'timeline',
    accentLight: '#6a0a4a', accentDark: '#e83db3',
    fidelity: 'standard', recommended: false,
  }),
]);

const CONCEPT_IDS = Object.freeze(CONCEPTS.map((x) => x.id));
// BT-013-09 (Terry, 2026-09-19, rejecting the original 15 outright: "at least 15 substantially
// redesigned, polished, distinct options... retaining the rejected designs with incremental
// adjustment is not completion"): five further, genuinely new dashboard patterns (briefing/inbox/
// ring-cluster/mosaic/ledger-strip — real new information structures, see compose.js), two further
// card styles (ribbon/layered) and one further nav style (tabs) and typographic voice
// (condensed-utility). Every one of the 15 concepts below was reassigned across this expanded axis
// set with a fresh identity (name, tagline, direction, audience, accent colours) — never the same
// combination Terry already saw and rejected. Concept `id`s are kept stable on purpose: they are
// referenced by picks/catalog storage (api/_shared/gallery.js) and existing tests that exercise that
// generic machinery, which does not depend on — and should not need to change for — a concept's own
// name or visual redesign.
const NAV_STYLES = Object.freeze(['top', 'rail', 'sidebar', 'sidebar-right', 'command', 'tabs']);
const DENSITIES = Object.freeze(['spacious', 'comfortable', 'compact', 'ultra-compact']);
const DASHBOARD_PATTERNS = Object.freeze(['metric-grid', 'chart-first', 'table-first', 'timeline', 'card-stack', 'goal-progress', 'merchant-feed', 'envelope-grid', 'command-console', 'split-focus', 'story-flow', 'adaptive', 'briefing', 'inbox', 'ring-cluster', 'mosaic', 'ledger-strip', 'reference-acru', 'reference-ledgerfly', 'reference-debtpayoff', 'trip-focus']);
const CARD_STYLES = Object.freeze(['flat-bordered', 'soft-shadow', 'outline-minimal', 'filled-tint', 'bordered-mono', 'ribbon', 'layered']);
const CHART_EMPHASES = Object.freeze(['bars', 'line', 'mixed', 'donut', 'area']);
const TYPE_VOICES = Object.freeze(['technical-mono', 'editorial-serif', 'friendly-rounded', 'bold-display', 'condensed-utility']);
const CATALOG_STATUSES = Object.freeze(['review', 'approved', 'retired']);

// Secondary-page composition axes (review, 2026-09-18: "Every concept is coherent beyond its
// dashboard; reject repeated generic secondary screens" — before this, every concept beyond the
// Dashboard rendered through ONE shared template, differing only in nav/density/card chrome, never
// in actual information hierarchy or structure). Read by app/js/ui/gallery/compose.js exactly like
// dashboardPattern is: each names one of several genuinely different renderer functions, never a
// palette swap of the same one.
//   transactionsPattern  'flat-list' | 'grouped-by-date' | 'dense-table' | 'card-list' | 'filter-first' |
//                        'reference-monsy' (BT-013-11, 2026-09-20: a third deliberately bespoke,
//                        non-reusable pattern — the same exception already established for
//                        dashboardPattern's 'reference-acru'/'reference-ledgerfly' and budgetPattern's
//                        'reference-finexa' — built closely against a real reference image, for the one
//                        concept that chooses it.)
//   billsPattern         'grouped-status' | 'timeline' | 'kanban-columns' | 'compact-table'
//   budgetPattern        'envelope-grid' | 'bar-comparison' | 'list-progress' | 'reference-finexa'
//                        (BT-013-10, 2026-09-20: 'reference-finexa' is a second deliberately bespoke,
//                        non-reusable pattern — the same exception dashboardPattern's 'reference-acru'
//                        already established above — built closely against the real Finexa reference
//                        image rather than the shared budgetPattern vocabulary, for the one concept
//                        that chooses it.)
//   accountsPattern      'card-grid' | 'table' | 'grouped-by-type' (BT-013 gap fix: Accounts/Merchants
//                        was not a Gallery page at all before this — the design brief names it as one
//                        of the required coordinated views for every concept)
//   settingsPattern      'flat-list' | 'two-column-grouped' (the latter mirrors the REAL responsive
//                        two-column settings layout shipped in the application itself, item 5)
//   sharedPattern        'balance-list' | 'ledger-table' | 'settlement-focus' (closes the gap named
//                        in this session's own "not done" note: Shared expenses and Trips were the
//                        last two required pages still sharing one template across all 15 concepts) |
//                        'reference-groupsplit' (BT-013-11, 2026-09-20: a fourth deliberately bespoke,
//                        non-reusable pattern, same exception as above, for the one concept that
//                        chooses it.)
//   tripsPattern         'card-grid' | 'list' | 'timeline'
const TRANSACTIONS_PATTERNS = Object.freeze(['flat-list', 'grouped-by-date', 'dense-table', 'card-list', 'filter-first', 'reference-monsy', 'reference-ledgerfly']);
const BILLS_PATTERNS = Object.freeze(['grouped-status', 'timeline', 'kanban-columns', 'compact-table', 'reference-ledgerfly']);
const BUDGET_PATTERNS = Object.freeze(['envelope-grid', 'bar-comparison', 'list-progress', 'reference-finexa', 'reference-ledgerfly']);
const ACCOUNTS_PATTERNS = Object.freeze(['card-grid', 'table', 'grouped-by-type', 'reference-ledgerfly']);
const SETTINGS_PATTERNS = Object.freeze(['flat-list', 'two-column-grouped']);
const SHARED_PATTERNS = Object.freeze(['balance-list', 'ledger-table', 'settlement-focus', 'reference-groupsplit', 'reference-ledgerfly']);
const TRIPS_PATTERNS = Object.freeze(['card-grid', 'list', 'timeline', 'reference-ledgerfly']);
// BT-013-15: the two new extra-page axes, declared only by concepts that list the matching page in
// their own `extraPages` (see the EXTRA_PAGES comment above) — never required of the other twelve.
const MERCHANTS_PATTERNS = Object.freeze(['reference-ledgerfly']);
const DEBT_PATTERNS = Object.freeze(['reference-ledgerfly']);

const findConcept = (id) => CONCEPTS.find((x) => x.id === id) || null;

module.exports = {
  CONCEPTS, CONCEPT_IDS, REQUIRED_PAGES, EXTRA_PAGES, REAL_LAYOUT_OPTIONS, REAL_DEFAULT_LAYOUT_ID,
  NAV_STYLES, DENSITIES, DASHBOARD_PATTERNS, CARD_STYLES, CHART_EMPHASES, TYPE_VOICES, CATALOG_STATUSES,
  TRANSACTIONS_PATTERNS, BILLS_PATTERNS, BUDGET_PATTERNS, ACCOUNTS_PATTERNS, SETTINGS_PATTERNS,
  SHARED_PATTERNS, TRIPS_PATTERNS, MERCHANTS_PATTERNS, DEBT_PATTERNS,
  findConcept,
};
