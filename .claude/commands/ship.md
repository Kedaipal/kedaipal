---
description: Run codegen, typecheck, lint/format, and tests before committing
---

Run these checks in order, stopping to report the failure if any step fails (don't silently continue past a failure):

1. `npx convex codegen` — regenerate Convex API types so typecheck sees the current schema/functions
2. `pnpm typecheck`
3. `pnpm check` — Biome lint **and** formatting/import order (what CI gates)
4. `pnpm test`

If everything passes, report a one-line summary (e.g. "all clear: typecheck, lint/format, tests pass"). If something fails, show the relevant error output and stop — do not attempt fixes unless asked.
