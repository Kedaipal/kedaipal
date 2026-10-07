# CI — PR gate (typecheck + lint + test)

The cheap, immediate safety net (ClickUp `86eyetzcw`): every PR runs the full
gate before merge, and nothing reaches production without passing it. The full
staging environment + deploy-pipeline rework is a separate ticket; this doc
covers what exists today.

## What runs when

| Event                        | Workflow                                | What happens                                    |
| ---------------------------- | --------------------------------------- | ----------------------------------------------- |
| `pull_request` (any base)    | `ci.yml`                                | Gate: lint → typecheck → test                   |
| `push` to `staging`          | `ci.yml`                                | Same gate on the post-merge result              |
| `push` to `main`             | `deploy.yml` → calls `ci.yml`           | Gate, then Convex deploy, then Cloudflare deploy |
| Manual (`workflow_dispatch`) | `ci.yml`                                | Gate on any branch, from the Actions tab        |

Notes:

- **PRs to any base branch** run the gate — not just `staging`/`main` — so
  stacked PRs (feature-on-feature) get feedback too. The `pull_request` event
  checks out the **merge result** against the base, not just the head branch.
- **`push` to `staging`** re-runs the gate on the merged state. Two PRs can
  each be green in isolation but conflict semantically once both merge; this
  catches that within minutes instead of at the next prod deploy.
- Superseded runs on the same PR are auto-cancelled (concurrency group);
  branch runs are never cancelled.

## The gate

One job, `Typecheck, lint & test`, defined **once** in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and reused by
`deploy.yml` via `workflow_call` — so the PR gate and the pre-deploy gate can
never drift apart again (the old `lint-and-check` job had drifted: it never
ran lint).

Steps: checkout → pnpm → Node → `pnpm install --frozen-lockfile` → paraglide
compile (`src/paraglide/` is gitignored; typecheck and tests need it) →
`pnpm check` → `pnpm typecheck` → `pnpm test` → `pnpm build`. Budget:
`timeout-minutes: 10` (~45 s locally; a couple of minutes on a runner).

The job's **`name:` is the required status check** in the `PR gate` ruleset, so
it deliberately still reads `Typecheck, lint & test` even though the first step
now gates formatting too. Renaming the job without editing the ruleset first
blocks every merge on a check that no longer reports.

`pnpm build` is in the gate because **`convex-deploy` runs before the
Cloudflare build**: a build-only breakage that reached `main` would deploy a
new Convex backend against the old frontend, with no rollback step. Verifying
the build before any deploy job removes that skew. It needs no `VITE_*`
values — those are read at runtime, so the build is secret-free like the rest
of the gate.

**Toolchain is pinned from the repo, not the workflow:**

- Node comes from [`.nvmrc`](../.nvmrc) (`node-version-file`) — currently
  **24**. Bump `.nvmrc` once and CI + deploy follow.
- pnpm comes from `package.json` `packageManager` (`pnpm/action-setup@v4`
  reads it) — currently 10.18.0.

**Why 24 specifically** (this bit is load-bearing — see the note below):
production deploys had been running `node-version: lts/*`, which resolves to
**24.18.0**, so 24 is what prod has actually been building on. Node 20 is
**EOL since 2026-04-30** (no security patches, on the job that holds
`CONVEX_DEPLOY_KEY` and `CLOUDFLARE_API_TOKEN`), and
`@tanstack/react-start` — a build-time vite plugin — declares
`engines.node: ">=22.12.0"`, which Node 20 does not satisfy. `engines.node`
in `package.json` is `>=22.12.0` to match the strictest real constraint in
the tree rather than the older, untrue `>=20`.

> **Don't pin `.nvmrc` below 22.12.** The first cut of this workflow switched
> deploy from `lts/*` to `.nvmrc` while `.nvmrc` still said `20`, which
> silently downgraded the production toolchain by four majors onto the one
> step no gate covered. Caught in review. If you bump `.nvmrc`, check it
> against `@tanstack/react-start`'s `engines` first.

No secrets or env vars are needed by the gate — `convex/_generated/` and
`src/routeTree.gen.ts` are checked in, and the test suite (convex-test +
edge-runtime) runs offline.

### `biome check`, not `biome lint`

The first step runs `pnpm check` (`biome check`), not `pnpm lint`. `biome lint`
evaluates **lint rules only** — it ignores the formatter and
`assist/source/organizeImports` entirely. For most of 2026 that meant
`biome check` was red on `staging` with nothing surfacing it:

| When | State |
|---|---|
| Jul 2026 | 9 files cleaned in PR #70; CI left on `biome lint` |
| Aug 2026 | 21 errors, recorded here as a known gap |
| Oct 2026 | 73 errors across 66 files — cleaned, and CI switched |

Drift grows monotonically because nothing stops it, and it is paid for by the
wrong person: a feature PR touching a drifted file either leaves it drifted or
sweeps unrelated reformat churn into its diff.

`check` is a strict superset of `lint`, so the switch loses no coverage. Two
properties keep it from being noisy:

- **Warnings still don't fail.** Biome exits non-zero on *errors* only. The 4
  pre-existing warnings (3 `noTemplateCurlyInString`, 1
  `noSuspiciousSemicolonInJsx`) report and pass, exactly as under `lint`.
- **It is auto-fixable in one command** — `npx biome check --write <paths>` —
  so a red format step is seconds of work, not a debugging session.

The trade-off is real and accepted: a logically perfect PR can now go red on a
tab. The root cause of that friction was fixed in the same change —
[`.vscode/settings.json`](../.vscode/settings.json) named Biome as the default
formatter for seven language IDs but **never set `editor.formatOnSave`**, so
nothing triggered it. That matches the split: `format` was 55 of the 73 errors.
It is now set **per-language, inside each Biome-owned block, not globally** — a
global `true` would hand Markdown and YAML to whatever other formatter is
installed, i.e. churn in files no gate checks.

`organizeImports` deliberately stays `"explicit"`. In VS Code `"explicit"`
already runs on a real save (it is the modern spelling of `true`); `"always"`
only adds auto-save, which would reorder imports mid-typing. The 18
`organizeImports` errors came from files written by tooling rather than
hand-saved, and CI now catches those.

Scope note: `biome.json` `files.includes` is still `src/**` only, so `convex/`
is neither linted nor formatted — tracked separately as `z8r3fdmdrf`.

## Branch protection (manual, one-time) — ✅ done 2026-08-02

Until this is done the gate **reports but doesn't block** — a red check is
just a red icon you can merge past. This is a repo-settings change, done once
by a repo admin; it is not code. It is **already enabled** (see
[Verifying it took effect](#verifying-it-took-effect)); the steps below are
kept for reference and for re-creating it.

The exact check name to require is **`Typecheck, lint & test`**. It only
appears in GitHub's search box after it has run at least once, which it has
(PR #159).

Use a **ruleset**, not classic branch protection: one ruleset targets
`staging` **and** `main` together, whereas classic needs a separate rule per
branch. Rulesets are also where GitHub is putting new functionality.

1. GitHub → **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.
2. Name it `PR gate`; set **Enforcement status: Active**.
3. Under **Target branches → Add target → Include by pattern**, enter
   `staging`, then repeat for `main` (two targets, one ruleset). There is no
   "pick a branch from a list" option — patterns are how you name a specific
   branch.

   **Enter the bare branch name — not `refs/heads/staging`.** The UI stores
   the `refs/heads/` prefix itself; typing it would save
   `refs/heads/refs/heads/staging` and match nothing. The fully-qualified
   form is only for the REST API (the `gh` call below). Confirm what was
   actually stored with the verify command at the end of this section.
4. Tick **Require status checks to pass**, then **Add checks** → search
   `Typecheck, lint & test` → select it.
5. Leave **Require branches to be up to date before merging** off unless you
   want every open PR to re-run CI after each merge to the base. It's safer
   but costs a re-run per merge, and the `push`-to-`staging` run already
   covers the merged result.
6. Tick **Block force pushes**. Leave "Require a pull request before merging"
   on if you want the no-direct-push rule enforced rather than conventional.
7. **Create**.

Equivalent via `gh` — one call covers both branches:

```bash
gh api -X POST repos/Kedaipal/kedaipal/rulesets --input - <<'EOF'
{
  "name": "PR gate",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/staging", "refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "non_fast_forward" },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "Typecheck, lint & test" }]
      }
    }
  ]
}
EOF
```

### Verifying it took effect

Check what the ruleset actually stored (targets should be **fully-qualified**
here even though you typed bare names in the UI):

```bash
gh api repos/Kedaipal/kedaipal/rulesets --jq '.[] | select(.name=="PR gate") | {targets: .conditions.ref_name.include, checks: [.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context]}'
```

Expected: targets `["refs/heads/main","refs/heads/staging"]`, checks
`["Typecheck, lint & test"]`.

Better still, ask GitHub what is enforced on a branch — this is the aggregate
of every ruleset, so it catches a rule that silently targets nothing:

```bash
gh api repos/Kedaipal/kedaipal/rules/branches/staging --jq '[.[].type]'
```

Expected: `["deletion","non_fast_forward","required_status_checks"]`.

**Enabled 2026-08-02** — ruleset `PR gate` (id 20243331), active, targeting
`main` + `staging`, requiring `Typecheck, lint & test`, strict off, bypass
list empty. Confirmed enforcing on PR #159 (`mergeStateStatus: CLEAN`).

A note on the older **`Basic safety net`** ruleset (id 18379053): it is
`active` but its include list is **empty**, so it targets no branches and
enforces nothing despite the name. Its two rules (`deletion`,
`non_fast_forward`) are both carried by `PR gate`, so it is redundant — safe
to delete, or give it targets if you want it to mean something. Worth knowing
that an active-looking ruleset can protect nothing.

Two things worth knowing before you turn it on:

- **It applies to you too.** With the ruleset active, a direct `git push` to
  `staging` or `main` is rejected unless the commit already carries a passing
  check. That enforces the PR-only rule the project already follows by hand,
  but it will bite if you're used to pushing a quick fix straight to
  `staging`. Bypass is available under the ruleset's **Bypass list** if you
  add yourself — leaving it empty is the stricter, recommended setting.
- **Plan check:** rulesets and required checks are free here because
  `Kedaipal/kedaipal` is a **public** repo. On a Free org a *private* repo
  can't use them at all — worth remembering if the repo is ever flipped
  private.

## Running the gate locally

`pnpm gate` runs exactly what CI runs, in the same order:

```bash
pnpm gate
```

That's `pnpm check && pnpm typecheck && pnpm test && pnpm build` — the same
four commands as the workflow's four steps (CI keeps them separate so the
Actions UI shows which one failed). Takes ~45 s on an M-series Mac.

`pnpm lint` still exists for a lint-only pass, but it is **not** what CI gates —
use `pnpm check` (or `pnpm gate`) before pushing, or formatting drift reaches
the PR. `npx biome check --write <paths>` fixes it; pass the failing paths
explicitly rather than a directory, so the diff stays yours.

It runs on whatever Node you have locally, which is **not** necessarily the
pinned 24 — check with `node -v` if you're chasing a CI-only failure.

If you change a workflow file itself, two extra checks:

```bash
act --list -W .github/workflows/ci.yml   # parses the YAML, shows jobs + triggers
brew install actionlint && actionlint    # static checker for expressions/syntax
```

A full local run of the workflow in Docker is possible —
`act pull_request -W .github/workflows/ci.yml --container-architecture linux/amd64`
— but it needs Docker Desktop running and pulls a large runner image. Note
the currently-installed `act` (0.2.8x) is flagged for CVE-2026-34041/34042;
`brew upgrade act` before using it that way. For this workflow it isn't worth
it: the gate is three pnpm commands, and `pnpm gate` tests them honestly.

**Note: nested Claude Code worktrees are excluded from BOTH lint and tests.**
`.claude/worktrees/` is gitignored but sits *inside* the repo, and neither
Biome (`useIgnoreFile: false`) nor vitest reads `.gitignore` — so each tool
needs its own exclusion:

- `biome.json` excludes `**/.claude/**`; without it Biome walks into a
  leftover worktree and aborts with "Found a nested root configuration".
- `vitest.config.ts` excludes `**/.claude/**` (PR #178 review); without it
  vitest **collects those worktrees' test files as if they were ours** — 694
  extra files in the main checkout as of Aug 2026, injecting hundreds of
  phantom failures from code that isn't on the current branch and making
  `pnpm gate` unusable there. CI never saw this (fresh clone, no worktrees);
  it only bit local runs in the main checkout.

If lint or tests fail in ways that don't match your diff, a stray nested
worktree is the first thing to suspect.

**Status (2026-08-24, ClickUp `86eyqgy05`): `.claude/worktrees/` is now empty.**
Nine stale trees holding 1,929 duplicate test files were audited and removed.
All nine had HEADs already reachable from `origin/staging`, so no committed
work was at risk; every dirty tree was archive-committed first, so removal
needed no `--force` and nothing was discarded. One genuinely unique piece of
work — the in-progress inbound intent router (ClickUp `86ey0e80h`) — was
committed to its own branch before removal.

**Both exclusions are retained deliberately, and must not be removed as dead
config.** They are now *preventative*: the directory regenerates the moment
anyone uses Claude Code's `EnterWorktree`, and the failure it causes (phantom
test failures from another branch, or a Biome "nested root configuration"
abort) is confusing enough that it cost two separate debugging sessions to
diagnose the first time. The exclusions cost nothing to keep.

All task work belongs in a **sibling** worktree instead — `../kedaipal-wt-<id>`,
branched from `origin/staging` — never inside the repo.

## Test timeouts — a synchronous test can only ever misfire on one (2026-09-29)

`testTimeout` in [`vitest.config.ts`](../vitest.config.ts) is **30 s**, not the
5 s default. That is not a slow-test allowance; the default was a false-failure
generator, and this is the fix.

**The mechanism.** `withTimeout` in `@vitest/runner` creates the timer *before*
it calls the test body:

```js
const timer = setTimeout(() => rejectTimeoutError(), timeout);
const result = fn(...args);            // synchronous body blocks the event loop
… else resolve(result);                // clears the timer, THEN checks the clock
```

A jsdom component test is synchronous from start to finish. While it runs, the
event loop is blocked, so that timer can never fire; when the body returns,
`resolve()` clears it and instead asserts `Date.now() - startTime < timeout`.
So on a synchronous test the timeout is a **post-hoc wall-clock measurement**:
it cannot interrupt a hang, and it cannot fail sooner than the body finishes.
Its only possible effect is to convert "the machine was busy" into "the test
failed". Raising it forfeits nothing.

**What it cost us.** In jsdom, one `CheckoutPage` render is ~9 ms and one
`getByRole(role, { name })` lookup is ~20 ms (it computes an accessible name
*and* a `getComputedStyle` visibility check for every element of that role).
Ordinary component tests therefore sit at 100–700 ms — well inside 5 s on an
idle box, and over it under ~8x machine load. Both
`src/components/storefront/checkout-form.test.tsx` and
`booking-checkout-form.test.tsx` were reproduced failing with
`Test timed out in 5000ms` on `origin/staging` (commit `0aac3095`) under load,
on the same commit that passes idle. It reads as order-dependence — the file
alone passes, the directory fails — but nothing is shared between files
(vitest isolates each one); the directory run simply adds enough contention to
cross the wall. `ubuntu-latest` is 4 shared vCPU, so this is a CI flake, not
only a many-parallel-sessions-on-a-laptop one.

**What still fails fast.** 30 s is ~40x our heaviest synchronous component
test, and almost nothing about failure reporting changes:

- an async test whose promise never settles still trips Testing Library's own
  `waitFor` budget — **5 s**, six times tighter than the test timeout on
  purpose (see the next section);
- anything genuinely stuck is caught by `timeout-minutes: 10` on the CI job;
- `hookTimeout` stays at its 10 s default — our hooks do no rendering. Raise it
  the day one does, for the same reason.

**What it costs**, so the trade is chosen rather than discovered: a
never-settling `await` **outside** `waitFor` has no tighter budget above it, so
it now fails in 30 s instead of 5 s. That is the price of not failing green
tests on a busy runner, and it is paid once per genuinely-broken test rather
than at random on healthy ones.

**Corollary for writing tests: never put `getByRole(role, { name })` in a
loop.** Resolve the node once and reuse it — React keeps the same DOM node
across re-renders, and a `expect(input.isConnected).toBe(true)` after the loop
is the tripwire if that ever stops being true (a remount would also drop the
buyer's caret, so it is worth knowing). `checkout-form.test.tsx`'s `typePhone`
was re-querying twice per character: a 15-character number spent 611 ms on
lookups against 130 ms of actual re-rendering. Hoisting the lookup cut that
test from 744 ms to 223 ms and the file from 2.6 s to 1.5 s.

### `asyncUtilTimeout` — 5 s, over a fixed 600 ms product timer

Testing Library's `waitFor` / `findBy*` budget is set in
[`vitest.setup.ts`](../vitest.setup.ts) (wired via `setupFiles`, guarded on
`typeof document` so the `edge-runtime` half of the suite never imports Testing
Library). It is **5 s**, not the 1 s default, and deliberately *not* 30 s:
unlike `testTimeout`, this budget is real protection. `waitFor` is genuinely
asynchronous, so it CAN interrupt a promise that never settles — it is what
makes a broken async expectation fail in seconds rather than at the test
timeout.

**This is a margin fix, not a reproduced flake.** Worth stating, because the
`testTimeout` change above *was* a reproduced failure and this one is not.

Found by sweeping the value down until the suite breaks:

| budget | full suite (idle) | `book-delivery-card.test.tsx` alone |
| --- | --- | --- |
| 1000 ms (old default) | 7337 pass | 42 pass |
| 800 ms | 7337 pass | 42 pass |
| 620 ms | — | 42 pass |
| 400 ms | **4 fail** | — |

The four are all in
[`src/components/order/book-delivery-card.test.tsx`](../src/components/order/book-delivery-card.test.tsx),
and they are slow for a legitimate reason: they wait on a **real product
timer**, `SPEND_ARM_DELAY_MS` (600 ms) — the anti-misclick delay that arms
Dispatch once a courier price lands. Real cost is therefore ~620 ms, and the 1 s
default left **~400 ms of slack over a fixed 600 ms floor**.

**That slack held under every load we could manufacture** — the full suite is
green at the old 1 s budget at load averages 237 and 278 on 8 cores. That result
does not clear the budget, it disqualifies the experiment: the dominant term is
a wall-clock `setTimeout`, which CPU starvation barely stretches, so synthetic
CPU load **under-models** this risk in a way it did not for `testTimeout`. What
would actually spend 400 ms of slack is slower hardware running the polling and
re-render around the timer (`ubuntu-latest` is 4 shared vCPU, not 8 fast local
ones), or anyone raising `SPEND_ARM_DELAY_MS` — which would eat it silently,
with the failure landing in a file that has nothing to do with their change.

5 s is ~8x the measured cost. **If you add a product delay above ~800 ms,
re-measure instead of arguing** — `ASYNC_UTIL_TIMEOUT_MS` exists for exactly
that:

```bash
ASYNC_UTIL_TIMEOUT_MS=400 pnpm test   # sweep down until it breaks
```

## Dependency pinning — TanStack is exact-pinned (2026-08-07, ClickUp 86eyjadx7)

`package.json` used to spec six TanStack packages as the `latest` dist-tag.
The lockfile kept CI honest (`--frozen-lockfile`), but a dist-tag re-resolves
on **any** lockfile touch — a `pnpm add` of an unrelated package on a dev
machine silently jumped the whole framework to whatever shipped that morning,
riding into an unrelated PR untested.

That stopped being hypothetical on 4 Aug 2026: TanStack shipped a ground-up
**lane-scheduler rewrite** of loader/preload/redirect/SSR-status handling as a
*patch* release tagged "Fix" (`react-router@1.170.19`,
[PR #7805](https://github.com/TanStack/router/pull/7805), 27 issues closed) —
exactly the machinery the buyer-page-resilience work (86eyheqzv) depends on.
Since TanStack ships breaking changes in patches, **no semver range protects
us**; only exact pins do.

The rules, enforced by `src/lib/dependency-pins.test.ts` (runs in the gate):

- **No dependency may use a dist-tag or wildcard spec** (`latest`, `next`,
  `*`) — every spec states a concrete version.
- **The TanStack router/start family is exact-pinned** (no `^`/`~`):
  `react-router`, `react-start`, `react-router-devtools`, `react-devtools`,
  `devtools-vite`, `router-plugin`. Upgrades are a deliberate task — bump the
  whole family **in lockstep** to one release, run the gate, and regression-test
  the buyer surfaces (see ClickUp 86eyjadza for the checklist).

`@tanstack/react-router-ssr-query` was removed in the same change — it was
imported nowhere (a scaffold leftover), and it was the only thing pulling
`@tanstack/react-query`/`query-core` into the lockfile. If a future change
adopts TanStack Query directly, add it as a first-class pinned dependency.

## App versioning — calendar `YYYY.MM.N` (2026-08-24, ClickUp 86eyqgxna)

Before this, the app had **no version at all** — no `version` in `package.json`,
zero git tags. Nothing identified a deploy, so "what version are you on?" had no
answer and a prod incident couldn't be pinned to a build.

**The scheme is `YYYY.MM.N`** — 4-digit year, zero-padded month, then the
release ordinal within that month, resetting monthly (`2026.08.1`, `2026.08.2`,
`2026.09.1`).

**Deliberately not semver.** There is no public API and no consumer pinning
against Kedaipal, so major/minor/patch would carry no meaning — every release
would be an arbitrary minor that tells a reader nothing. A calendar version
sorts naturally and says at a glance how stale a deploy is, which is the only
question anyone actually asks of it. A bare build number (`147`) was rejected
for the same reason: it conveys no recency.

### The convention: bump by hand in the release PR

`package.json` is the **single source of truth**, and it is bumped **manually in
the staging→main release PR** — deliberately not auto-incremented by CI.

That is not laziness. A human choosing the number is the same moment they decide
whether the release is notable enough to interrupt sellers with a "What's new"
modal (ClickUp `86eyqgxv9`). Automating the bump removes the only natural
checkpoint for that judgement.

### What enforces it

- **`src/lib/app-version.test.ts`** runs in the gate and fails if
  `package.json`'s version is missing or is not a valid `YYYY.MM.N`. It rejects
  semver, months outside `01`–`12`, an unpadded month (which sorts wrong as a
  string), ordinal `0`, and a leading-zero ordinal — `2026.08.01` and
  `2026.08.1` must never both be valid, or the release-notes "have I seen this
  version?" check has two answers for one build.
- **`vite.config.ts`** throws at config time if there is no version, and inlines
  it as `__APP_VERSION__` via `define` so runtime code never imports
  `package.json` into the client bundle. `src/lib/app-version.ts` is the only
  reader.
- **`deploy.yml`'s `tag` job** tags `main` as `v<version>` after a successful
  deploy — only what actually shipped gets tagged.

### If the version wasn't bumped

The tag job emits a **loud warning and continues** — it does not fail the
deploy. A hotfix to prod at 2am must never be blocked on remembering a version
bump; shipping the fix matters more than the tag. But an un-bumped release
silently ships under the previous version, which breaks the release-notes
"show once per version" contract, so the warning names that consequence
explicitly.

### Where a seller sees it

`AppVersionRow` renders in the dashboard chrome — the More panel on mobile, the
sidebar footer on desktop — not in a Settings tab. Its one job is support, so it
must be findable from whatever screen the seller is already on. It is
copy-to-clipboard because the realistic flow is reading it into a WhatsApp
message to us, and a mistyped version sends support down the wrong path. Hidden
while the sidebar is collapsed (the rail is icon-width and the row cannot
degrade into it legibly).

## Known gaps (deferred to the full CI/CD ticket)

- ~~**`pnpm check` is red on staging**~~ — **closed Oct 2026.** The one-off
  cleanup landed (66 files) and the gate now runs `pnpm check`; see
  [`biome check`, not `biome lint`](#biome-check-not-biome-lint).
- **Biome only scans `src/`** (`biome.json` `files.includes`) — `convex/`
  is not linted anywhere, in CI or locally.
- **`deploy.yml`'s deploy jobs have no concurrency guard** — two rapid
  merges to `main` still race `convex-deploy`/`deploy`. The *gate* jobs now
  serialize per-branch, which has a side effect worth recognising: with
  several merges in quick succession, a superseded queued gate is cancelled,
  so `needs: gate` skips that run's deploy. That's safer than racing, but it
  surfaces as a skipped/failed-looking deploy on `main` rather than an
  explicit "superseded".
- The deploy workflow's Convex env-var sync swallows failures
  (`|| echo "Warning..."`).
