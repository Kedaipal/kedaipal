# Release checklist — staging → main

**Trigger: any change to [`src/content/releases.ts`](../src/content/releases.ts).**

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
| **Environment variables** | `git diff origin/main..origin/staging \| grep -E '^\+' \| grep -oE '(process\.env\|import\.meta\.env)\.[A-Z_0-9]+' \| sort -u` | A new key must exist in **Convex prod** (`npx convex env set`) and/or the **Cloudflare** project **before** the merge, or the first request after deploy fails. Env-less code paths that *read* a new key fail closed — see the `WHATSAPP_APP_SECRET` precedent in [CLAUDE.md](../CLAUDE.md). |
| **Backfills / migrations** | `git diff origin/main..origin/staging -- convex/migrations.ts` | Every new `internalMutation` in that file is a **manual `npx convex run` on prod after the deploy**. Name it in the PR body with the exact command, say what it fixes, and say what the product looks like until it runs. |
| **Schema + indexes** | `git diff origin/main..origin/staging -- convex/schema.ts` | New **optional** fields deploy safely. A new **required** field, a narrowed validator, or a removed field needs the widen→migrate→narrow path. A new index costs a prod backfill window on a large table. |
| **Crons / HTTP routes / auth** | `git diff origin/main..origin/staging -- convex/crons.ts convex/http.ts convex/auth.config.ts` | A new cron starts firing on deploy — confirm the schedule and blast radius. A new webhook route needs its provider pointed at it. |
| **Outbound messaging** | grep the diff for new `sendTemplate` / template names | A WhatsApp template must be **approved by Meta** before the code that names it ships, or every send fails. Approval is not instant. |
| **Third-party setup** | new SDK in `package.json`, new provider in a settings card | Account, keys, webhook URL, sandbox→live switch. |
| **Privacy policy** | `git diff origin/main..origin/staging -- src/routes/privacy.tsx` | A **substantive** change (a new processor, a new data class) needs the shared `PRIVACY_VERSION` bump so consent is re-collected. Pure reformatting does not — say which it was. |
| **Plan gating** | `git diff origin/main..origin/staging -- convex/planGating.test.ts convex/plans.ts` | A capability moving behind a tier is a **removal** for sellers below it. Decide whether it needs a note, and warn support either way. |
| **Assets** | new files under `public/` | Confirm they are committed, not fetched from a machine that had them locally. |

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

1. Merge the release PR.
2. Deploy (Convex prod + Cloudflare).
3. Run any backfills — **after** the deploy, because a backfill usually writes a
   field the newly-deployed schema is the first to accept.
4. Tag `v<version>` on `main`.

Env vars are the exception: they go in **before** the merge, since code that
reads a missing key fails closed on its first request.
