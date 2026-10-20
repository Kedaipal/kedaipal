# Release checklist — staging → main

**Trigger: any change to [`src/content/releases.ts`](../src/content/releases.ts).**

**`/prep-staging` runs this whole procedure** — state probe, audit, notes, gates,
both PRs. This file stays the reference for *what* each row means; the skill at
`.claude/skills/prep-staging/SKILL.md` is the order of work.

Seller-facing release notes are only ever written for a staging→main merge, so
touching that file *is* the signal that a deploy is imminent. Everything below
belongs in the same change — not in a follow-up, and not in the merger's head.

The goal is that whoever merges the release PR **never has to ask "is there
anything for me to do?"**. The answer is already in the PR body, including when
it is "nothing" — an explicit *no envs, no backfills, no settings* is a finding,
not an omission, and it is the line that makes the checklist trustworthy.

## 1. Version

- [ ] Bump `package.json` to the version the notes claim (`YYYY.MM.N`).
      `src/lib/releases.test.ts` fails the build if the newest note is ahead of
      it, because notes for a version nobody is running are filtered out
      silently at runtime — the release would announce **nothing** and look like
      it worked.
- [ ] Newest entry first; `notable: true` only if the change alters how a seller
      works. See [whats-new.md](./whats-new.md).
- [ ] Every entry declares its `kind` (New feature / Enhancement / Bug fix).
      Required by the type, so this is a compile error rather than a reminder.

## 2. Audit the diff for operator work

Run each of these against `git diff origin/main..origin/staging` and record the
result — hit **or** miss — in the PR body.

| Check | Command | What a hit means |
| --- | --- | --- |
| **Environment variables** | `git diff origin/main..origin/staging \| grep -E '^\+' \| grep -oE '(process\.env\|import\.meta\.env)\.[A-Z_0-9]+' \| sort -u` — then **set-difference it against the same grep over `origin/main`**, or most hits are false | A new key must exist in **Convex prod** (`npx convex env set`) and/or the **Cloudflare** project **before** the merge, or the first request after deploy fails. Env-less code paths that *read* a new key fail closed — see the `WHATSAPP_APP_SECRET` precedent in [CLAUDE.md](../CLAUDE.md). A `+` line is any *moved or reindented* line, so already-live vars come back looking new — triage every survivor against what prod actually has. |
| **Env vars CI does not sync** | `git show origin/staging:.github/workflows/deploy.yml \| sed -n '/CONVEX_ENV_VARS=(/,/^ *done$/p'` | `deploy.yml` syncs only the names in that array. Any **other** new Convex key is a manual `npx convex env set … --prod`, or the code reading it fails closed on the first request after deploy. Secrets need GitHub *secrets*, not *vars*, if you add them to the array instead. |
| **Backfills / migrations** | `git diff origin/main..origin/staging -- convex/migrations.ts` | Every new `internalMutation` in that file is a **manual `npx convex run` on prod after the deploy**. Name it in the PR body with the exact command, say what it fixes, and say what the product looks like until it runs. **Write `--prod` yourself** — a migration's own docstring usually omits it, and the bare command silently runs against **dev** and reports success. |
| **Schema + indexes** | `git diff origin/main..origin/staging -- convex/schema.ts` | New **optional** fields deploy safely. A new **required** field, a narrowed validator, or a removed field needs the widen→migrate→narrow path. A new index costs a prod backfill window on a large table. Two false positives to expect: appending an index rewrites the previous line (trailing `,` → `)`) so it reads as added, and required fields on a **brand-new** table need no migration — pair the grep with the new-table list. |
| **Crons** | `git diff origin/main..origin/staging -- convex/crons.ts` | A new cron starts firing on deploy — confirm the schedule, the blast radius, and that it is idempotent. |
| **HTTP routes / auth** | `git diff origin/main..origin/staging -- convex/http.ts convex/auth.config.ts` — **read the diff, never grep for `path:`** | A new webhook route needs its provider pointed at it. **A route-path grep is not enough:** a provider registration can be required with *zero* new paths, when the work adds a branch to an existing handler (a second signature scheme on `/webhook/hitpay`, new Meta fields on `/webhook/whatsapp`). Both shipped that way and a path set-diff reported "none". |
| **Outbound messaging** | `git diff origin/main..origin/staging -- convex/lib/whatsapp.ts \| grep -E '^\+.*_TEMPLATE'` | A WhatsApp template must be **approved by Meta** before the code that names it ships, or every send fails. Approval is not instant. Where the code falls back safely when the env var is unset, the safe state is **unset** until approval is confirmed — do not set it on spec. Also check whether new Meta **webhook fields** must be subscribed in the App Dashboard (see [waba-protection.md](./waba-protection.md)); no grep covers that. |
| **Third-party setup** | `git diff --name-status origin/main..origin/staging -- convex/ \| grep '^A' \| grep -v '\.test\.'`, plus new provider cards in settings | Account, keys, webhook URL, sandbox→live switch. **Do not use "new SDK in `package.json`" as the proxy** — our integrations are hand-rolled `fetch` clients, so a whole new provider can ship with a byte-identical `pnpm-lock.yaml`. New files under `convex/` are the reliable signal. |
| **Privacy policy** | `git diff origin/main..origin/staging -- convex/lib/legal.ts src/lib/legal.ts src/routes/privacy.tsx src/routes/terms.tsx docs/data-retention.md` | A **substantive** change (a new processor, a new data class) needs the shared `PRIVACY_VERSION` bump so consent is re-collected. Pure reformatting does not — say which it was. The constant lives in `convex/lib/legal.ts` **and** `src/lib/legal.ts`, not in the route, so watching `privacy.tsx` alone misses a bump entirely. |
| **Plan gating** | `git diff origin/main..origin/staging -- convex/lib/plans.ts convex/planGating.test.ts src/lib/subscription.ts` | A capability moving behind a tier — or a **cap being lowered**, or a price rising — is a **removal** for sellers below it. Decide whether it needs a note, and warn support either way. The path is `convex/lib/plans.ts`; there is no `convex/plans.ts`, and pointing at one makes this row silently report "none". |
| **Assets** | `git diff --name-status origin/main..origin/staging -- public/ \| grep '^A'` | Confirm they are committed, not fetched from a machine that had them locally. |

## 3. Write it into the PR body

The release PR opens with a section that answers the merger's only question:

```markdown
## Before / after merge

**Env vars:** none  ← or: `FOO_KEY` must be set on Convex prod + Cloudflare first
**Backfill:** `npx convex run migrations:backfillX --prod` (after deploy) — until
it runs, <what the seller sees>
**Settings to enable:** none
**Meta templates:** none
```

Never leave a row out because it is empty. "None" is the information.

## 4. Order of operations

1. Merge the **notes** PR into `staging` first, so the release PR carries the
   bump and the notes as one unit.
2. Merge the release PR.
3. CI deploys on push to `main` — gate → Convex prod → Cloudflare → tag. Nothing
   to do by hand.
4. Run any backfills — **after** the deploy, because a backfill usually writes a
   field the newly-deployed schema is the first to accept.

Env vars are the exception: they go in **before** the merge, since code that
reads a missing key fails closed on its first request.

**Do not tag by hand.** `deploy.yml`'s `tag` job pushes `v<version>` after a
successful deploy, so only what actually shipped gets tagged. A manual tag makes
that job find the ref, warn, and exit 0 — leaving the real deploy looking
untagged.

**If `package.json` was not bumped, nothing fails.** The version guard is `<=`,
not `===` (most releases earn no note), the deploy succeeds, and the tag job
warns and exits 0 on purpose — a 2am hotfix must never be blocked on a version
bump. So the release ships untagged under the previous version while
`releasesInBuild` silently drops every note: it announces nothing and looks like
it worked in every log. Treat **`package.json` version == the newest `v*` tag**
as a hard red before opening the release PR.
