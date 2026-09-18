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
//                      'split-focus' | 'story-flow' | 'adaptive'
//   cardStyle         'flat-bordered' | 'soft-shadow' | 'outline-minimal' | 'filled-tint' | 'bordered-mono'
//   chartEmphasis     which shared accessible chart primitive leads: 'bars' | 'line' | 'mixed'
//   transactionsPattern / billsPattern / budgetPattern / accountsPattern / settingsPattern
//                      genuinely distinct secondary-page compositions (review, 2026-09-18) — see the
//                      dedicated comment above their axis constants near the bottom of this file.
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
const REQUIRED_PAGES = Object.freeze(['dashboard', 'transactions', 'bills', 'budget', 'accounts', 'shared', 'trips', 'settings']);

// The one real, selectable layout today (workspace setting `layoutId`, BT-011-07/BT-013): today's
// existing implicit application layout, kept exactly as it behaves now. Nothing in CONCEPTS below is
// in this list — that is the deliberate boundary between "under review in the Gallery" and "a real
// workspace may choose this".
const REAL_LAYOUT_OPTIONS = Object.freeze([{ value: 'classic', label: 'Classic (current)' }]);
const REAL_DEFAULT_LAYOUT_ID = 'classic';

function c(entry) { return Object.freeze(entry); }

const CONCEPTS = Object.freeze([
  c({
    id: 'executive-ledger', name: 'Executive Ledger',
    tagline: 'Structured, authoritative, high-information financial overview.',
    direction: 'A left sidebar of every section, a dense ledger-first dashboard, and figures given precedence over illustration — built for someone who reads a balance sheet before breakfast.',
    distinct: 'The dashboard leads with a real transaction table (table-first), not cards; the sidebar shows every section at once instead of a top strip, so orientation never costs a click.',
    audience: 'Owners and managers who want authority and completeness: every account, every recent entry, at a glance, before anything decorative.',
    strengths: ['Nothing is hidden behind a summary — the real ledger is the hero.', 'Sidebar orientation means no second click to see what exists.', 'Scans fast for someone who already knows what they are looking for.'],
    tradeoffs: ['Busier first impression; not reassuring for someone anxious about money.', 'Sidebar costs horizontal room on tablet.'],
    accessibilityNotes: ['Dense tables need generous row height at 200% zoom; verified no overflow at 320px by reflowing to cards.', 'Sidebar order matches reading order for screen readers (nav before main).'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'table-first', cardStyle: 'flat-bordered', chartEmphasis: 'bars',
    transactionsPattern: 'dense-table', billsPattern: 'compact-table', budgetPattern: 'list-progress', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'modern-banking', name: 'Modern Banking',
    tagline: 'Refined consumer-banking experience with clean account cards.',
    direction: 'A calm top bar, rounded account cards you would recognise from a banking app, and a stacked-card dashboard that leads with "your money", not a table.',
    distinct: 'Card-stack dashboard composition (each account is its own soft-shadow card with its own recent activity), the opposite structural choice from Executive Ledger\'s table-first hero.',
    audience: 'Everyday members who want their bank app\'s familiarity: balances first, detail on request.',
    strengths: ['Immediately legible to anyone who has used a banking app.', 'Account cards scale gracefully to any number of accounts.', 'Calm visual rhythm reduces anxiety around checking balances.'],
    tradeoffs: ['Less information density than Executive Ledger for power users.', 'Soft shadows need care to stay within contrast and reduced-motion rules.'],
    accessibilityNotes: ['Card borders and shadows never the only signal of separation (also spacing and headings).', 'Reduced motion collapses the card entrance transition to none.'],
    density: 'comfortable', navStyle: 'top', dashboardPattern: 'card-stack', cardStyle: 'soft-shadow', chartEmphasis: 'line',
    transactionsPattern: 'card-list', billsPattern: 'grouped-status', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'card-grid',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'financial-command-center', name: 'Financial Command Center',
    tagline: 'Dense operational dashboard for advanced users.',
    direction: 'An icon-only rail (maximum content width), ultra-compact spacing, and a multi-panel "command console" dashboard: alerts, forecast, bills and balances all visible without scrolling on a wide screen.',
    distinct: 'The only concept combining an icon rail with a purpose-built multi-panel console pattern — four independent panels composed together, not one hero plus a list.',
    audience: 'Power users running several accounts, budgets and a shared-expense group who want everything live at once.',
    strengths: ['Maximum information per screen for wide monitors.', 'Icon rail reclaims width for content.', 'Every "needs attention" signal is on screen together.'],
    tradeoffs: ['Icon-only rail needs strong tooltips/labels for new users and screen-reader users.', 'Ultra-compact density is the wrong choice for anyone who prefers spacious layouts — never the default.'],
    accessibilityNotes: ['Icon rail items keep full text labels for assistive technology even though they are visually hidden.', 'Ultra-compact spacing still keeps 44px hit targets via padding, not just the visible glyph.'],
    density: 'ultra-compact', navStyle: 'rail', dashboardPattern: 'command-console', cardStyle: 'outline-minimal', chartEmphasis: 'bars',
    transactionsPattern: 'dense-table', billsPattern: 'kanban-columns', budgetPattern: 'bar-comparison', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'settlement-focus', tripsPattern: 'list',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'calm-budget', name: 'Calm Budget',
    tagline: 'Spacious, reassuring and approachable without feeling childish.',
    direction: 'A single wide reading column, generous whitespace, and a short daily "story" of what happened with money rather than a wall of numbers.',
    distinct: 'Story-flow dashboard: one narrow narrative column (today\'s summary, then this week, then what needs attention) instead of a grid of cards or a table.',
    audience: 'People who find budgeting stressful and want plain language and breathing room before figures.',
    strengths: ['Lowest cognitive load of any concept.', 'Reads well on mobile without any layout change.', 'Plain-language summaries reduce the "wall of numbers" feeling.'],
    tradeoffs: ['Low information density; a power user will find it slow to scan.', 'Long page for someone with many accounts.'],
    accessibilityNotes: ['Single column removes any reading-order ambiguity.', 'Generous line-height and text size by default (this concept\'s own density is already the most spacious).'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'story-flow', cardStyle: 'soft-shadow', chartEmphasis: 'line',
    transactionsPattern: 'flat-list', billsPattern: 'timeline', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'card-grid',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'precision-grid', name: 'Precision Grid',
    tagline: 'Compact tables, sharp alignment and rapid scanning.',
    direction: 'An icon rail, compact density and a monospace-leaning table aesthetic: sharp borders, right-aligned figures, no rounded cards.',
    distinct: 'Bordered-mono card style is unique to this concept: hairline borders, square corners, tabular figures — a deliberately unrounded, unshadowed visual language.',
    audience: 'Spreadsheet-minded users who want the fastest possible scanning of exact figures.',
    strengths: ['Fastest figure-to-figure scanning of any concept.', 'Alignment and monospaced numerals reduce misreading amounts.', 'Minimal chrome maximises rows visible.'],
    tradeoffs: ['Can feel cold or "spreadsheet-like" to a casual user.', 'Sharp corners and hairlines need care to stay above 3:1 non-text contrast.'],
    accessibilityNotes: ['Hairline borders verified at >=3:1 against surface in every palette/mode (same check as the login page\'s preview cards).', 'Table headers keep scope="col"/"row" regardless of density.'],
    density: 'compact', navStyle: 'rail', dashboardPattern: 'table-first', cardStyle: 'bordered-mono', chartEmphasis: 'bars',
    transactionsPattern: 'dense-table', billsPattern: 'compact-table', budgetPattern: 'list-progress', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'wealth-overview', name: 'Wealth Overview',
    tagline: 'Polished net-worth, assets, liabilities and trend presentation.',
    direction: 'A sidebar for orientation and a chart-first dashboard whose hero is the net-position trend line, with assets/liabilities broken out beneath it.',
    distinct: 'Chart-first dashboard emphasising the TREND over time (a line chart hero) rather than a single point-in-time figure — the only concept whose hero panel is explicitly historical.',
    audience: 'Owners tracking net worth and long-term position across several accounts and a loan.',
    strengths: ['Trend is immediately visible, not just today\'s number.', 'Assets vs liabilities breakdown answers "what do I actually have" at a glance.', 'Sidebar keeps every section reachable while looking at the trend.'],
    tradeoffs: ['A new workspace with little history has a flat, unhelpful trend line at first.', 'Chart-first layouts need the surrounding numeric table for anyone the chart does not reach.'],
    accessibilityNotes: ['Every chart pairs with the existing sr-only figure table pattern (from the Usage page); the line itself is never the only source of the numbers.', 'Line colour kept distinguishable from category colours already in use, never relying on hue alone (also different dash pattern per series).'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'chart-first', cardStyle: 'soft-shadow', chartEmphasis: 'line',
    transactionsPattern: 'grouped-by-date', billsPattern: 'timeline', budgetPattern: 'bar-comparison', accountsPattern: 'grouped-by-type', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'timeline',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'household-hub', name: 'Household Hub',
    tagline: 'Shared household planning, responsibilities and bills.',
    direction: 'A spacious top-nav layout whose dashboard leads with a stack of "what the household needs" cards: shared bills due, who paid what, and the shared balance.',
    distinct: 'Card-stack dashboard like Modern Banking, but the cards are household-scoped (shared bills, shared balance, members) rather than personal accounts — same structural family, different subject and audience.',
    audience: 'Households, couples and roommates who split bills and want shared context, not personal net worth.',
    strengths: ['Puts shared responsibility front and centre for multi-person workspaces.', 'Bills-due and balances share one visual language, so nothing shared is out of sight.', 'Spacious top-nav is approachable for less financially fluent household members.'],
    tradeoffs: ['Less useful for a single-person personal workspace (not its audience).', 'Needs Shared expenses turned on to show its strongest card.'],
    accessibilityNotes: ['Household member list never shows another member\'s private account information (structural composition only — the underlying authorization is unchanged by layout).', 'Cards reflow to one column at 320px with no truncation of names.'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'card-stack', cardStyle: 'soft-shadow', chartEmphasis: 'bars',
    transactionsPattern: 'card-list', billsPattern: 'grouped-status', budgetPattern: 'envelope-grid', accountsPattern: 'grouped-by-type', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'card-grid',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'travel-ledger', name: 'Travel Ledger',
    tagline: 'Trips, multiple currencies, shared expenses and settlement emphasis.',
    direction: 'A top-nav layout with a split-focus dashboard: balances on one side, the active trip and shared-expense settlement on the other, so a trip in progress is never a click away.',
    distinct: 'Split-focus dashboard pattern is unique to this concept and Analyst Workspace\'s filter-pane cousin: two co-equal panels side by side rather than one hero plus a list.',
    audience: 'Groups travelling together who split costs across currencies and need to see who owes whom without leaving the dashboard.',
    strengths: ['Trip and settlement context is always visible, not buried in a separate page.', 'Multi-currency figures shown with their original amount and rate, matching the app\'s existing invariant.', 'Natural home for the "fewest payments" settlement suggestions.'],
    tradeoffs: ['Less useful outside a group/trip workspace.', 'Two-panel split needs to stack cleanly on mobile (verified single-column at 390px).'],
    accessibilityNotes: ['Currency figures always paired with their code, never a bare symbol.', 'Split-panel layout uses a single DOM reading order (balances, then trip) so it matches visually at every width.'],
    density: 'comfortable', navStyle: 'top', dashboardPattern: 'split-focus', cardStyle: 'soft-shadow', chartEmphasis: 'bars',
    transactionsPattern: 'grouped-by-date', billsPattern: 'timeline', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'timeline',
    fidelity: 'standard', recommended: true,
  }),
  c({
    id: 'minimal-professional', name: 'Minimal Professional',
    tagline: 'Restrained, typography-led interface with minimal decoration.',
    direction: 'A quiet top bar, spacious density and a story-flow dashboard rendered with almost no chrome — typography and whitespace do the work that colour and cards do elsewhere.',
    distinct: 'Outline-minimal card style with the story-flow pattern: unlike Calm Budget\'s soft, rounded reassurance, this concept is deliberately austere — rules instead of shadows, hairlines instead of fills.',
    audience: 'Users who find most finance apps visually noisy and want the plainest possible presentation of real figures.',
    strengths: ['Extremely low visual noise; nothing competes with the numbers.', 'Fast to render, nothing decorative to distract from content.', 'Ages well — least likely of any concept to look dated.'],
    tradeoffs: ['Provides the fewest visual landmarks for orientation; relies more on text hierarchy.', 'Some users read minimalism as "unfinished".'],
    accessibilityNotes: ['Outline-only cards keep a visible focus ring that does not rely on the card\'s own border.', 'Heading hierarchy is the primary orientation cue and is kept strictly logical.'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'story-flow', cardStyle: 'outline-minimal', chartEmphasis: 'line',
    transactionsPattern: 'flat-list', billsPattern: 'timeline', budgetPattern: 'list-progress', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'list',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'analyst-workspace', name: 'Analyst Workspace',
    tagline: 'Filters, comparisons, reporting and data-density emphasis.',
    direction: 'A compact layout with a persistent right-hand filter/comparison rail beside a table-first dashboard, so filtering never navigates away from the data.',
    distinct: 'The only concept with `sidebar-right`: a persistent secondary panel for filters/comparisons rather than navigation, paired with table-first density on the left.',
    audience: 'Analysts and detail-oriented owners who filter, compare periods and export rather than browse.',
    strengths: ['Filters stay visible while scanning results — no round trip to a separate filter page.', 'Table-first hero keeps real figures central.', 'Naturally extends to side-by-side period comparison.'],
    tradeoffs: ['Right-hand rail costs width on narrower desktop screens; collapses to a drawer under 1024px.', 'Not the friendliest first impression for a casual user.'],
    accessibilityNotes: ['The filter rail is reachable by keyboard before the results in tab order when open, and is a labelled region either way.', 'Collapsing the rail to a drawer keeps focus management (opens with focus inside, closes returning focus to its toggle) — the same pattern as the command picker\'s panel.'],
    density: 'compact', navStyle: 'sidebar-right', dashboardPattern: 'table-first', cardStyle: 'outline-minimal', chartEmphasis: 'bars',
    transactionsPattern: 'filter-first', billsPattern: 'compact-table', budgetPattern: 'bar-comparison', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'goal-navigator', name: 'Goal Navigator',
    tagline: 'Savings goals, debt payoff and progress milestones.',
    direction: 'A spacious top-nav layout whose dashboard hero is progress: debt payoff and savings trajectory shown as milestones reached and remaining, ahead of raw balances.',
    distinct: 'Goal-progress dashboard pattern: the hero answers "am I on track", not "what is my balance" — a motivational framing distinct from every balance-first or table-first concept.',
    audience: 'People actively paying down debt or saving toward something specific, who want to see progress, not just numbers.',
    strengths: ['Progress framing is motivating and answers a different, real question than a balance sheet.', 'Debt and savings share one visual language of milestones.', 'Naturally extends to the forecast\'s "what-if" scenarios (pay more, pay less) already built.'],
    tradeoffs: ['Less useful for someone with no active goal or debt — degrades gracefully to a plain balance view when neither exists.', 'Milestone framing can feel gamified in a way some users dislike; kept plain-text and figure-first, never a badge/points system.'],
    accessibilityNotes: ['Every progress meter keeps the existing figure-as-text rule; "on track" / "behind" stated in words, never colour alone.', 'No animated counters — reduced motion is respected identically to every other concept.'],
    density: 'spacious', navStyle: 'top', dashboardPattern: 'goal-progress', cardStyle: 'soft-shadow', chartEmphasis: 'bars',
    transactionsPattern: 'flat-list', billsPattern: 'grouped-status', budgetPattern: 'bar-comparison', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'card-grid',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'merchant-insights', name: 'Merchant Insights',
    tagline: 'Merchant activity, patterns, subscriptions and spending history.',
    direction: 'A sidebar layout whose dashboard hero is a feed of merchant activity: recent and recurring merchants, subscription-type bills, and spend trend per merchant.',
    distinct: 'Merchant-feed dashboard pattern: the only concept whose hero organises by WHO money went to, rather than by account, category or date.',
    audience: 'Users who want to notice forgotten subscriptions and recurring merchants and understand spending patterns per merchant.',
    strengths: ['Surfaces recurring/subscription merchants where they are easy to miss elsewhere.', 'Uses the existing managed-merchant directory and its icons directly, never free text.', 'Natural home to notice a merchant whose spending is rising.'],
    tradeoffs: ['Less useful for a workspace with few distinct merchants.', 'Needs merchants to be well-maintained (closed/reopened correctly) to stay accurate — inherits the existing merchant lifecycle rules unchanged.'],
    accessibilityNotes: ['Every merchant row keeps its managed icon plus visible name (icon never the only identifier).', 'Feed is a real list (ul/li), ordered and readable by assistive technology in the same order as sighted users see it.'],
    density: 'comfortable', navStyle: 'sidebar', dashboardPattern: 'merchant-feed', cardStyle: 'flat-bordered', chartEmphasis: 'bars',
    transactionsPattern: 'card-list', billsPattern: 'grouped-status', budgetPattern: 'envelope-grid', accountsPattern: 'grouped-by-type', settingsPattern: 'flat-list', sharedPattern: 'ledger-table', tripsPattern: 'card-grid',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'card-workspace', name: 'Card Workspace',
    tagline: 'Modular, configurable cards with clear hierarchy.',
    direction: 'A top-nav layout whose dashboard is a grid of independent, clearly-titled cards (balances, bills, budget, forecast, shared) — a general-purpose "pick your cards" composition rather than one dominant hero.',
    distinct: 'Metric-grid-style composition but explicitly modular/general-purpose (no single hero pattern dominates) — positioned as the most flexible, least opinionated dashboard composition of the twenty.',
    audience: 'Users who want a bit of everything without committing to one narrow point of view (a reasonable "default-leaning" concept).',
    strengths: ['Balanced coverage of every major concern (balances, bills, budget, forecast, shared) with equal visual weight.', 'Easiest concept to extend with a new card type later without restructuring the page.', 'Familiar "dashboard of widgets" mental model.'],
    tradeoffs: ['No single strong point of view — less memorable than a concept built around one clear idea.', 'Equal-weight cards can bury the single most important alert if there are many cards.'],
    accessibilityNotes: ['Cards are headed sections (aria-labelledby) in a stable, logical order — not a drag-and-drop layout (which would need far more accessibility work than this review scope covers).', 'Grid reflows to one column at 320px, in the same DOM order.'],
    density: 'comfortable', navStyle: 'top', dashboardPattern: 'metric-grid', cardStyle: 'soft-shadow', chartEmphasis: 'bars',
    transactionsPattern: 'card-list', billsPattern: 'kanban-columns', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'settlement-focus', tripsPattern: 'card-grid',
    fidelity: 'standard', recommended: false,
  }),
  c({
    id: 'sidebar-pro', name: 'Sidebar Pro',
    tagline: 'Persistent professional navigation and productivity-oriented content.',
    direction: 'A compact sidebar and a metric-grid dashboard: a tight grid of the key figures (net position, budget status, bills due, shared balance) with the sidebar always present for fast section-to-section movement.',
    distinct: 'Metric-grid dashboard paired with sidebar nav at compact density — the most "daily productivity tool" combination, distinct from Card Workspace\'s more spacious, general-purpose version of the same grid idea.',
    audience: 'Frequent, daily users who move between sections often and want the fastest key-figures overview plus fast navigation.',
    strengths: ['Fastest section-to-section movement of any sidebar concept (compact density, persistent sidebar).', 'Key-figures grid answers the most common daily questions in one glance.', 'Scales well as a genuinely everyday-use tool.'],
    tradeoffs: ['Compact density is not for everyone — never the site default.', 'Sidebar plus grid needs disciplined implementation to avoid feeling cramped on 13"-class laptop screens (verified at 1280px).'],
    accessibilityNotes: ['Sidebar landmark (nav) precedes main in the DOM regardless of visual position.', 'Compact density keeps the same 44px interactive target sizes as every other density (padding compensates for smaller visible chrome).'],
    density: 'compact', navStyle: 'sidebar', dashboardPattern: 'metric-grid', cardStyle: 'outline-minimal', chartEmphasis: 'bars',
    transactionsPattern: 'dense-table', billsPattern: 'compact-table', budgetPattern: 'list-progress', accountsPattern: 'table', settingsPattern: 'two-column-grouped', sharedPattern: 'ledger-table', tripsPattern: 'list',
    fidelity: 'flagship', recommended: true,
  }),
  c({
    id: 'focus-mode', name: 'Focus Mode',
    tagline: 'Simplified daily financial actions with deeper details on demand.',
    direction: 'An almost-nav-less top bar (one primary action, one "more" link) and a spacious story-flow dashboard reduced to the single most relevant thing right now — with every other section one click away, never removed.',
    distinct: 'The most reduced navigation of any concept (command-adjacent minimalism without requiring keyboard command usage) — a deliberate "do the one thing" framing rather than an overview.',
    audience: 'Users who open the app to do one quick thing (add an expense, check "am I okay today") and do not want a dashboard to read.',
    strengths: ['Fastest path to the single most common action (Add expense).', 'Lowest chance of feeling overwhelmed on open.', 'Every section still fully reachable — nothing is actually removed, only de-emphasised.'],
    tradeoffs: ['Weakest overview of any concept — a poor fit for anyone who wants a dashboard.', 'Needs a clear, discoverable way to the rest of the app (a visible "More" / full nav toggle, always present, never hidden behind a gesture).'],
    accessibilityNotes: ['The "more" control is a real, labelled, always-present link/button, never a swipe-only affordance.', 'Reduced navigation never reduces the number of landmarks below one nav + one main.'],
    density: 'spacious', navStyle: 'command', dashboardPattern: 'story-flow', cardStyle: 'soft-shadow', chartEmphasis: 'line',
    transactionsPattern: 'flat-list', billsPattern: 'timeline', budgetPattern: 'envelope-grid', accountsPattern: 'card-grid', settingsPattern: 'flat-list', sharedPattern: 'balance-list', tripsPattern: 'timeline',
    fidelity: 'standard', recommended: false,
  }),
]);

const CONCEPT_IDS = Object.freeze(CONCEPTS.map((x) => x.id));
const NAV_STYLES = Object.freeze(['top', 'rail', 'sidebar', 'sidebar-right', 'command']);
const DENSITIES = Object.freeze(['spacious', 'comfortable', 'compact', 'ultra-compact']);
const DASHBOARD_PATTERNS = Object.freeze(['metric-grid', 'chart-first', 'table-first', 'timeline', 'card-stack', 'goal-progress', 'merchant-feed', 'envelope-grid', 'command-console', 'split-focus', 'story-flow', 'adaptive']);
const CARD_STYLES = Object.freeze(['flat-bordered', 'soft-shadow', 'outline-minimal', 'filled-tint', 'bordered-mono']);
const CHART_EMPHASES = Object.freeze(['bars', 'line', 'mixed']);
const CATALOG_STATUSES = Object.freeze(['review', 'approved', 'retired']);

// Secondary-page composition axes (review, 2026-09-18: "Every concept is coherent beyond its
// dashboard; reject repeated generic secondary screens" — before this, every concept beyond the
// Dashboard rendered through ONE shared template, differing only in nav/density/card chrome, never
// in actual information hierarchy or structure). Read by app/js/ui/gallery/compose.js exactly like
// dashboardPattern is: each names one of several genuinely different renderer functions, never a
// palette swap of the same one.
//   transactionsPattern  'flat-list' | 'grouped-by-date' | 'dense-table' | 'card-list' | 'filter-first'
//   billsPattern         'grouped-status' | 'timeline' | 'kanban-columns' | 'compact-table'
//   budgetPattern        'envelope-grid' | 'bar-comparison' | 'list-progress'
//   accountsPattern      'card-grid' | 'table' | 'grouped-by-type' (BT-013 gap fix: Accounts/Merchants
//                        was not a Gallery page at all before this — the design brief names it as one
//                        of the required coordinated views for every concept)
//   settingsPattern      'flat-list' | 'two-column-grouped' (the latter mirrors the REAL responsive
//                        two-column settings layout shipped in the application itself, item 5)
//   sharedPattern        'balance-list' | 'ledger-table' | 'settlement-focus' (closes the gap named
//                        in this session's own "not done" note: Shared expenses and Trips were the
//                        last two required pages still sharing one template across all 15 concepts)
//   tripsPattern         'card-grid' | 'list' | 'timeline'
const TRANSACTIONS_PATTERNS = Object.freeze(['flat-list', 'grouped-by-date', 'dense-table', 'card-list', 'filter-first']);
const BILLS_PATTERNS = Object.freeze(['grouped-status', 'timeline', 'kanban-columns', 'compact-table']);
const BUDGET_PATTERNS = Object.freeze(['envelope-grid', 'bar-comparison', 'list-progress']);
const ACCOUNTS_PATTERNS = Object.freeze(['card-grid', 'table', 'grouped-by-type']);
const SETTINGS_PATTERNS = Object.freeze(['flat-list', 'two-column-grouped']);
const SHARED_PATTERNS = Object.freeze(['balance-list', 'ledger-table', 'settlement-focus']);
const TRIPS_PATTERNS = Object.freeze(['card-grid', 'list', 'timeline']);

const findConcept = (id) => CONCEPTS.find((x) => x.id === id) || null;

module.exports = {
  CONCEPTS, CONCEPT_IDS, REQUIRED_PAGES, REAL_LAYOUT_OPTIONS, REAL_DEFAULT_LAYOUT_ID,
  NAV_STYLES, DENSITIES, DASHBOARD_PATTERNS, CARD_STYLES, CHART_EMPHASES, CATALOG_STATUSES,
  TRANSACTIONS_PATTERNS, BILLS_PATTERNS, BUDGET_PATTERNS, ACCOUNTS_PATTERNS, SETTINGS_PATTERNS,
  SHARED_PATTERNS, TRIPS_PATTERNS,
  findConcept,
};
