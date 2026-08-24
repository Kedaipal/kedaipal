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
`pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build`. Budget:
`timeout-minutes: 10` (~45 s locally; a couple of minutes on a runner).

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

That's `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — the same
four commands as the workflow's four steps (CI keeps them separate so the
Actions UI shows which one failed). Takes ~45 s on an M-series Mac.

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

## Known gaps (deferred to the full CI/CD ticket)

- **`pnpm check` (Biome lint + format) is red on staging** (21 format
  errors as of Aug 2026). The gate deliberately runs `pnpm lint` only;
  format enforcement needs a one-off `biome format --write` cleanup first.
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
