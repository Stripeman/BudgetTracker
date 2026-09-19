# BT-009-25 worked examples: settlement units, itemized receipts, linked refunds, shared income/deposits

Written before implementation, per Terry's instruction (2026-09-19): each example below traces real
fictional numbers through the proposed default model and states the expected balances/output, so any
material ambiguity is found on paper first. All names and amounts are fictional. Currency: EUR
throughout, minor units (cents) used internally exactly like every other calculation in this
codebase (`api/_shared/money.js`), largest-remainder rounding (`money.allocate`) used wherever an
amount must be split and reconciled exactly to a total — the same proven mechanism every existing
split method already uses, never a new rounding rule invented for these four items.

## 1. Couples/families as a settlement unit

**Model:** a `groupSettlementUnit` is a purely organizational, display/suggestion-time grouping of
two or more existing participants (`{id, name, memberRefs: [...], createdBy, createdAt, active}`).
It changes nothing about how expenses, shares or payments are recorded or attributed — every
expense/share/payment still names one real, individually identifiable participant, exactly as
today. A unit only affects the "Settle up" VIEW: when a settlement view groups by unit, its members'
individual nets are summed into one combined row for that view, and minimum-payment suggestions may
treat the unit as one node (fewer total payments), but any settlement actually RECORDED still names
one real person as `from`/`to` — a unit itself can never hold money, appear on a settlement record,
or gain any access.  This directly satisfies "unit membership must not grant access, rewrite
historical allocations or silently move liability between people": the underlying per-person ledger
is completely unchanged; only the summary the person chooses to view differs.

**Worked example.** Fictional Dinner Club: Alice, Bob (a couple — unit "The Smiths", `memberRefs:
[alice, bob]`), and Carol. A EUR 90.00 dinner, Alice pays, split equally three ways (30.00 each).

- Per-person net (unchanged from today, no unit applied): Alice +60.00 (paid 90, owes 30), Bob
  −30.00, Carol −30.00.
- Settlement view **without** the unit selected: unchanged — suggestions are Bob→Alice 30.00,
  Carol→Alice 30.00 (2 payments).
- Settlement view **with** "The Smiths" unit selected: the combined row is `The Smiths: +60.00 +
  (−30.00) = +30.00`, Carol: −30.00. Suggestion: **Carol → a member of The Smiths, 30.00** (1
  payment instead of 2) — the UI must still ask WHICH member of the unit actually receives it
  (defaulting to whichever member has the larger individual net, here Alice, but requiring
  confirmation, never silently guessed) because a settlement record's `to` field must always name a
  real participant. Recording it as Carol→Alice 30.00 updates Alice's and Carol's own individual
  nets exactly as any ordinary settlement always has; Bob's own net is untouched by this settlement
  (he was never the one being paid) — the unit reduced the payment COUNT, never who is individually
  credited. Expected final individual nets after this one settlement confirms: Alice 0.00 (was
  +60.00, received −60.00... wait — recompute: Alice starts +60.00; a confirmed 30.00 payment FROM
  Carol TO Alice reduces Carol's negative net by 30 and increases Alice's positive net's "received"
  by 30 in the existing `balances()` formula (net = paid − share − received... — using the codebase's
  own established sign convention, confirmed payments TO a person reduce their positive net by the
  amount received): Alice's net becomes +60.00 − 30.00 = +30.00 (still owed by Bob), Bob unchanged
  at −30.00, Carol becomes 0.00 (settled). This is IDENTICAL to what would have happened with an
  ordinary, non-unit "Carol pays Alice 30" — proving the unit changed only the suggestion/display,
  never the underlying arithmetic.

**No blocking ambiguity found.** Terry's own constraints ("aggregate only for the selected
settlement view", "never... silently move liability") map directly onto "a unit is a view/suggestion
layer over unchanged individual records, and a real settlement always still names a real receiving
person" — proceeding to build this.

## 2. Itemized receipt allocation

**Model:** an expense may optionally carry `itemization: { lines: [{id, description, quantity,
unitPriceMinor, allocations: [{ref, quantity}] | 'shared-equally' | 'shared:[refs]'}], taxMinor,
tipMinor, discountMinor, feeMinor, allocationBasis: 'proportional' }`. Each line's total
(`quantity * unitPriceMinor`) is allocated to the participants named in its `allocations` (a line
bought entirely by one person: one allocation; a shared line: split equally, or by explicit
quantities, among the named participants). `taxMinor`/`tipMinor`/`feeMinor` (added) and
`discountMinor` (subtracted) are then allocated to every participant who has at least one item line,
**proportionally to each participant's own item-line subtotal**, using `money.allocate`'s
existing deterministic largest-remainder algorithm so the total always reconciles EXACTLY to the
receipt total (`itemsSubtotal + tax + tip − discount + fee`), with any residual cent going to the
first participant by allocation order — identical convention to every other split method in this
codebase. This becomes a new split method, `'itemized'`, alongside the existing five; the resulting
per-person shares are the expense's real `split.lines`/`shares`, computed and stored exactly like
any other method's output, never a second, parallel total.

**Worked example.** A EUR 35.40 restaurant receipt, Alice/Bob/Carol at dinner:
- Burger 12.00 → Alice only.
- Salad 10.00 → Bob only.
- Shared appetizer 8.00 → Alice, Bob, Carol equally.
- Item subtotal = 12.00 + 10.00 + 8.00 = 30.00.
- Tax 2.40, Tip 6.00, Discount −3.00 → net addition 5.40. Total = 30.00 + 5.40 = 35.40 (the receipt
  total, entered as the expense's own `amount`, validated to equal the sum below — a mismatch is a
  shown error, never silently accepted).
- Per-person item subtotal: Alice = 12.00 + 8.00/3 = 14.6667 → **14.67** (rounded via
  `money.allocate` across the two who share the appetizer... actually the appetizer split itself is
  computed once, in minor units: 800 cents ÷ 3 = `money.allocate(800, [1,1,1])` = [267, 267, 266]),
  so Alice's shared-appetizer part = 267, Bob's = 267, Carol's = 266 (the residual cent to the first
  listed, same convention as every other split). Alice item subtotal = 1200 + 267 = 1467 (14.67),
  Bob = 1000 + 267 = 1267 (12.67), Carol = 0 + 266 = 266 (2.66). Sum = 1467+1267+266 = 3000 (30.00) ✓.
- Tax+tip−discount = 540 cents, allocated proportionally to {1467, 1267, 266} out of 3000:
  Alice 540×1467/3000 = 264.06 → weight-rounded via `money.allocate(540, [1467,1267,266])` (the
  SAME weighted largest-remainder function `money.allocate` already supports for shares) =
  [264, 228, 48] (264+228+48 = 540 ✓).
- **Final shares:** Alice = 1467+264 = **1731 (17.31)**, Bob = 1267+228 = **1495 (14.95)**,
  Carol = 266+48 = **314 (3.14)**. Sum = 1731+1495+314 = **3540 (35.40)** ✓ — reconciles exactly to
  the receipt total, as required.
- If a participant is later unchecked from a shared line, or a line's allocation is left with no
  one assigned, the "unallocated remainder" is shown as its own explicit line ("EUR 8.00 not yet
  allocated to anyone") and the Save action is refused until it is either allocated or explicitly
  marked as a fee/discount/tax field instead — never silently dropped or silently spread across
  everyone without being shown first.

**No blocking ambiguity found.** The proportional-by-item-subtotal allocation of tax/tip/discount is
a default, not specified verbatim by Terry, but it is the standard, expected behavior for this kind
of feature (matching how virtually every comparable bill-splitting tool behaves) and satisfies every
stated acceptance criterion (allocable lines, quantities, shared lines, tax/tip/discount/fee,
unallocated remainder shown, exact reconciliation) — proceeding to build this, documented as an
explicit design decision here rather than silently assumed.

## 3. Linked refunds

**Model:** a `groupRefund` record: `{id, refundOf: expenseId, amountMinor, currency, date, reason,
allocation: {method, lines}, status: 'active'|'voided', history}`. It never edits the original
expense (BT-001-05: corrections are amendments, never rewrites) — the original expense's own
amount/split/history stays exactly as recorded forever. `allocation` DEFAULTS to the original
expense's own split lines and method (same people, same proportions) but can be explicitly
overridden before saving (an itemized receipt refund of just one item, for example) — always shown,
never silently applied. `balances()` is extended to treat an active refund exactly like a negative
expense scoped only to the refunded participants: it reduces the ORIGINAL PAYER's effective "paid"
by the refunded amount, and reduces each refunded participant's effective "share" by their allocated
part — computed on read, alongside the original expense, never mutating it. A refund never touches
an existing CONFIRMED settlement record (Terry: "never silently rewrite confirmed settlements") —
instead, the changed net after a refund is a normal, new open balance, settled by a normal new
settlement, exactly like any other balance change.

**Worked example.** Fictional Dinner Club, EUR 90.00 dinner, Alice pays, split equally among
Alice/Bob/Carol (30.00 each). Bob's 30.00 payment to Alice is reported and then **confirmed**
(before any refund exists). Balances after Bob's confirmed payment: Alice +30.00 (60 − 30 received),
Bob 0.00 (settled), Carol −30.00 (unconfirmed/no payment yet).

A week later the restaurant refunds Alice EUR 30.00 for an overcharge. Alice records a linked
refund of 30.00 against the original expense, default allocation = the original equal split (30.00
÷ 3 = 10.00 each reduction in each person's true share of the now-EUR-60.00 real cost).

- The original expense's own record is untouched: still shows EUR 90.00, split equally, Alice paid,
  history intact.
- The refund reduces Alice's effective "paid" from 90.00 to 60.00, and each of Alice/Bob/Carol's
  effective "share" from 30.00 to 20.00 (their allocated 10.00 reduction each).
- Recomputed **effective** per-person figures for this expense+refund pair: Alice paid 60, share 20,
  advance = 40 (paid beyond her own share); Bob share 20, no payment made toward it yet in this
  expense's own terms; Carol share 20, no payment made yet.
- Bob's CONFIRMED settlement of 30.00 is **never rewritten** — it stays a real, historical, confirmed
  30.00 payment. But now Bob's true share (20.00) is LESS than what he already paid (30.00): Bob has
  a genuine new **10.00 repayment obligation owed back to him** — shown as a new, distinct, open
  balance ("Alice owes Bob 10.00, resulting from a refund on 'Fictional dinner'"), never merged into
  or silently altering Bob's original confirmed settlement record. Carol, who has paid nothing yet,
  now simply owes 20.00 instead of 30.00 — her own not-yet-settled balance decreases by 10.00, no
  repayment-obligation complexity needed since nothing of hers was ever confirmed.
- Expected final net balances immediately after the refund (before any NEW settlement resolves
  Bob's 10.00): Alice = paid 60 − share 20 − received 30 (Bob's earlier confirmed payment) =
  **+10.00**; Bob = share 20 − paid-in-full 30 (his own earlier settlement counts as his payment
  toward the group, exactly like today's existing repayment/receivable accounting) = **−10.00**
  (i.e., Bob is now owed 10.00 back — the SIGN here matches this codebase's existing convention that
  a negative number is money that person is owed once interpreted through the repayment side, exactly
  as an overpayment already works today for a person who paid more than their group share); Carol =
  share 20 − paid 0 = **−20.00** (down from −30.00, as expected). Net sum check: +10.00 + (−10.00) +
  (−20.00) = −20.00... **this does not sum to zero**, which every existing balance invariant test in
  this codebase requires (`api/test/group-model.test.js`'s hand-computed nets always sum to zero
  per currency) — tracing the discrepancy: the refunded 30.00 LEFT the group entirely (returned to
  Alice from the restaurant, not redistributed among Bob/Carol), so the group's total pool of money
  genuinely shrank by 30.00; the existing balance formula's zero-sum invariant assumes every euro
  paid by someone is owed by someone else WITHIN the group — a refund that returns money to only the
  original payer, from OUTSIDE the group, is the first case where that assumption does not hold
  without an explicit adjustment. **Resolution (still no blocking ambiguity, a straightforward
  correction to the model, not a design choice needing Terry):** the refund's rebate must also be
  reflected as reducing what the PAYER (Alice) is considered to have "paid" out of pocket in the
  group's own zero-sum ledger, which the model above already does (60 instead of 90) — recomputing
  Alice's net at 60 − 20 − 30(received) = **+10.00** is correct; Bob at 20 − 30(his own settlement
  counted as payment toward his share, i.e. an overpayment of 10) = **−10.00**; Carol at 20 − 0 =
  **+... wait, Carol OWES 20, so her net is −20.00.** Re-summing: +10.00 − 10.00 − 20.00 = −20.00,
  still nonzero. The genuine root cause: Alice's net formula must ALSO subtract the refund amount
  she personally received from the outside world, since that 30.00 came from outside the group's own
  internal transfers, not from Bob or Carol — Alice's true corrected net is paid(60) − share(20) −
  received-from-Bob(30) = +10, which is already what was computed; the imbalance instead means Carol
  and Bob's TOTAL owed (30.00 combined: 10+20) does not match what Alice is now net-owed (10.00) —
  because the group's TOTAL adjusted cost is 60.00 (90−30 refunded), of which Alice fronted 60 and is
  owed back her two friends' 40.00 total share (20+20), while she has ALREADY received 30 of it from
  Bob — so Alice should be owed exactly 40−30 = **+10.00** (matches), Bob should be owed **back**
  10.00 (he paid 30 for a 20 share, i.e. he OVERPAID by 10, so he is a genuine creditor of the group
  for 10.00, meaning Bob's net should be **+10.00**, not −10.00 — **this was a sign error in the
  manual trace above, corrected here**), and Carol owes 20.00, net **−20.00**. Correct sum:
  **+10.00 (Alice) + 10.00 (Bob) − 20.00 (Carol) = 0.00** ✓. This confirms the model is sound once
  Bob's overpayment is correctly signed as a positive net (he is owed, exactly like anyone who paid
  more than their true share always already is in this codebase's existing, proven convention) —
  the arithmetic mistake was in the manual trace, not the model; the actual implementation must be
  verified against this corrected worked example with a hand-computed test asserting the sum is
  exactly zero, exactly like every other balance test in this codebase already does.

**No blocking ambiguity found** — the model is sound (confirmed by re-deriving the example to a
correct zero-sum result); the trace above is kept verbatim, including the corrected arithmetic, as
the literal test case to implement against.

## 4. Shared income, prepaid contributions and deposits

**Model:** a new, clearly SEPARATE record type, `groupContribution`: `{id, contributor: ref, holder:
ref, amountMinor, currency, date, kind: 'contribution'|'deposit', status: 'held'|'applied'|
'returned'|'forfeited', applications: [{expenseId, amountMinor}], returnedAmountMinor, notes,
history}`. A contribution/deposit is **never** an `expense` or `income` transaction kind on anyone's
private account (Terry: "must not count as income or spending merely because money moved") — it is
its own kind of record, with its own small, separate "Fund" balance report per holder, entirely
independent of the existing expense/settlement `balances()` output. When a holder pays a real shared
expense using fund money, that expense is recorded exactly as today (the holder is its real payer,
matching who actually transacted, for audit accuracy) — the fund ledger separately tracks, per
contributor, how much of their contribution has been `applied` (consumed by expenses their holder
paid) versus still `held` versus `returned`. A contributor's own true "cost" for a fund-paid expense
is their normal split share of it, exactly like any other expense — the fund only tracks whose
ADVANCE MONEY covered it, a distinct question from whose actual expense share it was.

**Worked example.** Trip fund: Alice (holder), Bob, Carol each contribute EUR 100.00 in advance
(kind: `contribution`, status: `held`). Fund ledger: Alice holds 300.00 total (100 of her own + 100
from Bob + 100 from Carol), each contributor's own `held` = 100.00. **None of this appears as income
for Alice or spending for Bob/Carol on any private account** — it is shown only in the new Fund
report ("You have contributed EUR 100.00, held by Alice, not yet applied").

Later, a EUR 250.00 hotel is paid by Alice (recorded as a completely ordinary shared expense, Alice
as payer, split equally among Alice/Bob/Carol — 83.33/83.33/83.34). This is unaffected by the fund
at all in the expense/settlement balance math: normal balances apply exactly as they always have
(Alice +166.67 or +166.66 depending on rounding, Bob −83.33, Carol −83.34 in the ordinary sense of
"who owes the group for this expense"). Separately, in the Fund report, Alice marks EUR 250.00 of the
fund as `applied` to this expense, allocated proportionally to each contributor's own held balance
(100/300 each): 83.33 applied from each of Alice's, Bob's and Carol's own contributions (largest-
remainder rounded to reconcile exactly to 250.00, same mechanism as everywhere else). Fund ledger
after this: Alice held 16.67, Bob held 16.67, Carol held 16.66 (100−83.33, 100−83.33, 100−83.34).

At trip end, the remaining EUR 50.00 (16.67+16.67+16.66) is returned to each contributor in full
(status → `returned`, `returnedAmountMinor` recorded per contribution) — again, this return is
**never** recorded as income for Bob/Carol nor as an expense for Alice; it is simply the fund ledger
closing out. The Fund report for each person plainly states: "You contributed EUR 100.00 to Alice's
trip fund; EUR 83.33/83.34 was applied to shared expenses; EUR 16.67/16.66 was returned to you" —
three distinct, auditable numbers per person, matching Terry's explicit requirement to preserve who
contributed, who holds it and how it was applied or returned, as first-class separate facts.

**Material ambiguity found — this is the ONE specific question below.** The worked example above
resolves cleanly ONLY because the fund's `applied` allocation is a purely INFORMATIONAL, separate
report, never merged into or netted against the existing expense/settlement balance. But this raises
a real design fork with a real consequence either way:

> **Question:** Should the Fund report's "applied" tracking ever be allowed to REDUCE what a
> contributor is separately shown to owe in the ordinary Shared-expenses balance (i.e., should
> "Carol already fronted 83.34 of the hotel cost via her earlier contribution" ever net against
> "Carol's ordinary 83.34 share of the hotel expense" so her Shared-expenses balance shows 0.00 for
> that expense instead of −83.34), or should the two dimensions (ordinary expense-sharing balance,
> and fund contribution/application/return tracking) always stay fully separate, non-netting reports
> that a person must look at BOTH to understand their true overall position?
>
> **My recommendation: keep them fully separate, never netting.** Consequence of my recommendation:
> a contributor's ordinary Shared-expenses balance will show them as "owing" their normal share of
> every fund-paid expense exactly as if they had paid nothing in advance, and they must additionally
> check the separate Fund report to see that this same amount was, in effect, already covered by
> their earlier contribution. This is honest and simple to build/audit/test correctly (it is just
> today's existing, proven balance math, completely untouched, plus one new independent report), and
> matches Terry's own instruction to "preserve who contributed, who holds the money and how it is
> subsequently applied or returned" as distinctly trackable facts rather than one blended number —
> but it does mean the two views can feel confusing side by side ("why does it say I owe 83.34 when
> I already gave Alice 100 for exactly this?") unless the UI states the connection in words very
> clearly wherever both are shown together. The alternative (netting them into one number) is
> materially riskier: it would require redefining what "paid"/"share" mean inside `balances()` itself
> for every fund-linked expense, touching the one calculation every other feature in this codebase
> already depends on and has extensive existing tests against, for a benefit (one blended number)
> that is not what Terry explicitly asked for ("must not count as income or spending merely because
> money moved" reads to me as an argument FOR keeping the two dimensions separate, not for blending
> them). **I am proceeding to build the separate, non-netting version while awaiting confirmation or
> correction**, continuing all other unrelated authorized work in the meantime, per the instruction
> not to stop for this alone.
