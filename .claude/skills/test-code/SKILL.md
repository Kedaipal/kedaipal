---
name: test-code
description: Hands-on test of a Kedaipal branch in Zaki's own Chrome while he watches — you drive every scenario end to end (seller and buyer side), judging logic, flow, UI/UX and where each new component sits, and report findings as they surface. Use when the user runs /test-code or asks you to test something yourself ("test it", "test T1", "let's test this", "run the test on my chrome"). Not for running the automated gates (use /ship) or reviewing a diff (use /pr-review or /code-review).
---

# Kedaipal hands-on test — you drive, Zaki eyeballs

Zaki is the CTO and watches the browser while you work. **"Test it" never means
"run the test suite" and never means "click the happy path and report it
works."** The gates (`/ship`) are a precondition. This is the human test: you
drive his real Chrome through every scenario and act as the reviewer who
catches what tests can't. A step that technically works but reads confusingly,
sits in the wrong place, or leaves a state undesigned is a **finding**, not a
pass.

## The bar — judge every step on four layers

1. **Logic.** Does the rule actually hold? Client and server agree, edge cases
   from the ticket behave, nothing silently accepts what it should refuse.
2. **Flow.** Can the seller or buyer get from intent to done with no dead ends?
   Is the next step obvious? Are defaults sensible? Does each new state open
   something the other side now has to understand?
3. **UI/UX.** Every state is designed: empty, one, many, error,
   disabled-with-reason, loading. Copy says what happens, not just what it is.
   Check a 375px phone and desktop: nothing truncated, tap targets ≥44px,
   semantic tokens, controls match the house ([`docs/design-system.md`](../../../docs/design-system.md)).
4. **Placement.** Is each new component where its **meaning and urgency** put
   it? Would a seller look for it there? New things are never "appended where
   the code happened to be" — if it's in the wrong home, that's a finding even
   if it works (CLAUDE.md, "No lazy / convenient placement").

**Check the copy against the code.** Every promise the UI makes ("shown in the
WhatsApp confirmation", "buyers never see it") must be true. Grep the renderer
before accepting it.

## Before touching the browser

1. **Pin down what's under test**: the worktree, branch and ClickUp ticket. Read
   the ticket's acceptance criteria and the PR body.
2. **Write the scenario list before driving.** Happy path, every failure state
   the change introduces, the ticket's edge cases, regressions in the feature
   it extends, and **both sides** (seller dashboard and buyer storefront /
   checkout / `/track`). Share it with Zaki in one short block so he knows
   what's coming.
3. **Account types.** Decide up front what's needed: a standard seller, admin
   act-as, a plan tier (Starter vs Pro gating), a buyer. Buyer surfaces are
   public and need no sign-in. **You cannot enter credentials.** If more than
   one signed-in account type is needed, tell Zaki now, finish every scenario
   on the first account, then ask him to switch. Don't count on reaching an
   incognito window; the extension usually can't.
4. **Backend: the dev deployment is shared.** Run `npx convex dev --once` **from
   the worktree under test** right before starting, because other sessions push
   over it. If the push is refused on schema validation, another branch's test
   data is in the way. Report it and don't force anything.
5. **Frontend.** Start the worktree's dev server with `preview_start` using its
   `.claude/launch.json` entry (add one with the `-C <worktree>` pattern if it's
   missing). A new port is a new Clerk origin, so Zaki may need to sign in once.

## Driving

- Load the Claude-in-Chrome tools in **one** `ToolSearch` call.
- Open a **new tab** and never take over one of his existing tabs. Tell him
  which tab you're driving.
- Before each scenario, say in one line what you're about to do and what should
  happen. Take a screenshot at every point where there's something to judge, so
  what you see matches what he sees.
- Check mobile (`resize_window` 375×812) and desktop wherever the change
  renders, and reset to desktop at the end.
- For behaviour that depends on the clock (opening hours, "today", expiries),
  set the data up relative to **now** rather than waiting for real time.
- Read the page (`read_page` / `get_page_text` / `find`) to verify text, and use
  `javascript_tool` only to inspect, never to change what the user would do.

## Ask first, even mid-test

Stop and get Zaki's yes, naming the exact action, before anything that leaves
the local app:

- sending a WhatsApp or email, including a claim-link send or a placed order
  that notifies a buyer number
- entering any real person's phone number or name
- calling a paid or sandbox third party (Lalamove, Delyva, HitPay)
- downloading a file (CSV or PDF export)

Offer the safe alternative when one exists, such as verifying an export's
contents in the page instead of downloading it. Never enter credentials, never
touch prod, never merge.

## Findings: report as they surface

| Severity | Meaning |
|---|---|
| **BLOCKER** | Wrong data or logic, a dead end, copy that lies, a server rule the client contradicts |
| **SHOULD-FIX** | Confusing flow, misplaced component, undesigned state, truncation, off-house control |
| **NIT** | Polish that doesn't change understanding |

Write each one as **did → saw → expected → where** (`file:line` when known).
Don't quietly fix things mid-test. Keep testing, collect the findings, and at
the end ask Zaki which to fix. Fixes land **in the branch under test** (same
PR) with tests, and you re-run the affected scenarios afterwards.

## Finish

1. A pass/fail table covering every scenario, then the findings by severity.
2. **Clean up shared dev data** that uses fields only this branch declares.
   Rows carrying them stop every narrower branch's `convex dev --once` until
   they're removed. Remove the data through the UI, or tell Zaki exactly what's
   left and why.
3. Reset the viewport, close only the tabs you opened, and state the next step.
   Zaki merges every PR himself.
