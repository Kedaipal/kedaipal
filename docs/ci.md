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

## Branch protection (manual, one-time)

Required status checks make a red gate actually **block** the merge button.
This is a repo-settings change done once by an admin (not in code):

1. GitHub → **Settings → Branches → Add branch protection rule**.
2. Branch name pattern: `staging`.
3. Tick **Require status checks to pass before merging**, search for and
   select **`Typecheck, lint & test`** (the check appears in the search only
   after it has run at least once — open any PR first).
4. Leave "Require branches to be up to date" off unless you want every open
   PR to re-run CI after each merge (safer, but adds a re-run per merge —
   the `push`-to-`staging` run already covers the merged result).
5. Repeat steps 1–3 for `main`.

Or via `gh` (same effect, per branch):

```bash
gh api -X PUT repos/Kedaipal/kedaipal/branches/staging/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "contexts": ["Typecheck, lint & test"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

A side effect worth knowing: with required checks on, **direct pushes** to
`staging`/`main` are blocked unless the commit already has a passing check —
which enforces the "everything goes through a PR" rule the project already
follows.

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
