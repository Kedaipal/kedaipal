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
`pnpm lint` → `pnpm typecheck` → `pnpm test`. Budget: `timeout-minutes: 10`
(the whole gate runs in ~35 s locally; a few minutes on a runner).

**Toolchain is pinned from the repo, not the workflow:**

- Node comes from [`.nvmrc`](../.nvmrc) (`node-version-file`) — currently 20,
  matching `engines.node >= 20`. Bump `.nvmrc` once and CI + deploy follow.
- pnpm comes from `package.json` `packageManager` (`pnpm/action-setup@v4`
  reads it) — currently 10.18.0.

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

That's `pnpm lint && pnpm typecheck && pnpm test` — the same three commands
as the workflow's three steps (CI keeps them separate so the Actions UI shows
which one failed). Takes ~35 s on an M-series Mac.

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

**Note:** `pnpm lint` scans `src/` per `biome.json`. The config excludes
`.claude/**` — without that, Biome walks into any Claude Code worktree left
under `.claude/worktrees/` and aborts with "Found a nested root
configuration". If lint ever fails that way again, a stray nested worktree is
the cause.

## Known gaps (deferred to the full CI/CD ticket)

- **No build step in the gate.** A PR that breaks `vite build` but passes
  tsc/lint/vitest only fails at deploy time — after Convex has already
  deployed, before Cloudflare does (deploy-order skew). The build needs
  `VITE_*` vars, so it belongs with the staging-environment work.
- **`pnpm check` (Biome lint + format) is red on staging** (21 format
  errors as of Aug 2026). The gate deliberately runs `pnpm lint` only;
  format enforcement needs a one-off `biome format --write` cleanup first.
- **Biome only scans `src/`** (`biome.json` `files.includes`) — `convex/`
  is not linted anywhere, in CI or locally.
- **`deploy.yml` has no concurrency guard** — two rapid merges to `main`
  race their deploy jobs.
- The deploy workflow's Convex env-var sync swallows failures
  (`|| echo "Warning..."`).
