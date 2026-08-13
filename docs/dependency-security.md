# Dependency security & upgrade policy

How we keep third-party code safe, what our current advisory posture is, and what is
deliberately accepted. Companion to [`whatsapp-webhook-security.md`](./whatsapp-webhook-security.md)
(inbound request auth), [`ci.md`](./ci.md#dependency-pinning--tanstack-is-exact-pinned-2026-08-07-clickup-86eyjadx7)
(the pinning rules and their guard test) and [`infra-cost-scaling.md`](./infra-cost-scaling.md)
(platform limits).

## Why this doc exists

We shipped to paying customers with a **critical** advisory sitting in the auth SDK for an
unknown length of time, because nothing routinely looked. Dependency drift is silent — it
produces no failing test and no error in the logs. This doc makes the check explicit.

## Policy

1. **`pnpm audit --prod` is the check.** `--prod` matters: it scopes to what can actually
   reach production. Dev-only tooling advisories are real but a different risk class.
   It is **run by hand** — at the monthly pass below, and on any PR that touches
   `package.json`. It is deliberately **not** in the CI gate yet: the prod tree currently
   carries 1 critical and 31 high (all transitive, see posture below), so a blocking step
   would fail every build from day one, and a non-blocking one is a warning nobody reads.
   Wiring it in properly means first clearing or explicitly allow-listing today's findings,
   then failing on anything new — its own ticket, and the reason the `shadcn` cleanup below
   is the highest-value prerequisite.
2. **Critical and high advisories in runtime dependencies are fixed on sight** — not
   scheduled, not batched into a quarterly upgrade.
3. **Monthly bump pass.** One reviewed PR per month for routine drift. Without a cadence,
   "we'll upgrade when we need to" means never, and the gap becomes a migration.
4. **CLI/scaffolding tools never belong in `dependencies`.** They drag server frameworks
   into the production tree (see the `shadcn` note below).
5. **No dist-tag specifiers, and peer-coupled framework packages are exact-pinned.**
   Both rules are enforced by `src/lib/dependency-pins.test.ts` in the CI gate, so a
   drifting spec fails the build rather than riding into an unrelated PR.

## Current posture (2026-08-13)

**79 advisories** across the prod tree — 1 critical / 31 high / 39 moderate / 8 low
(`pnpm audit --prod` reports 95, counting one advisory once per dependency path).
**All are transitive; none are in first-party code.**

The Clerk advisories are resolved as of this date:

| Advisory | Path | Resolution |
|---|---|---|
| Clerk middleware route-protection bypass ([GHSA-vqx2-fgx2-5wq9](https://github.com/advisories/GHSA-vqx2-fgx2-5wq9), critical, `@clerk/shared` <4.8.1) + authorization bypass ([GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c), high, `@clerk/{shared,react,backend,tanstack-react-start}`) | direct dependency | `@clerk/tanstack-react-start` 1.0.11 → **1.4.31**, lifting shared 4.5.0 → 4.28.1, react 6.2.0 → 6.14.1, backend 3.2.7 → 3.16.4 — all above their patched thresholds |

### Where the remaining findings come from

| Source | Paths | Note |
|---|---|---|
| `shadcn` | 36 | **A CLI in `dependencies`.** Pulls Express + the MCP SDK into the prod tree, including the one remaining `hono` high. Removing it deletes the single largest slice of our audit surface at zero functional cost — separately ticketed. |
| `@cloudflare/vite-plugin` | 25 | Build tooling; ships nothing to the client. |
| `@tanstack/react-start` | 20 | Build/SSR tooling, transitive. Exact-pinned, so it moves only via the lockstep upgrade (86eyjadza). |
| `exceljs` | 8 | Runtime (product import/export). Exposure is narrow — it parses seller-supplied spreadsheets, never buyer input. |
| `@tanstack/react-devtools` | 3 | Carries the one open **critical** — see below. |
| `@inlang/paraglide-js` | 3 | Build-time message compiler; includes a `kysely` high (JSON-path injection) reached only by the compiler, never by request-handling code. |

### Open, with reasoning

- **`seroval` ≤1.5.2 `fromJSON()` type confusion (critical)** — reaches us on exactly one
  path, `@tanstack/react-devtools → @tanstack/devtools → solid-js → seroval`. Devtools code
  deserializes only its own local panel state, so there is no attacker-controlled input on
  this path in production. It is unfixed here because `@tanstack/react-devtools` is
  exact-pinned under the TanStack freeze; clearing it means either the lockstep upgrade
  (86eyjadza), a `pnpm.overrides` entry, or moving devtools out of `dependencies` — each a
  deliberate change with its own build verification, not a drive-by in a security bump.
- **`shadcn`-sourced findings** are accepted **only until that package leaves
  `dependencies`**. They are not "won't fix" — they are the largest cleanup available and
  are already ticketed.

Everything else above is build-time tooling whose compromise would require an attacker
already inside our build pipeline.

## Auth upgrade notes (Clerk 1.0 → 1.4)

Our Clerk surface is small and conventional, which is why a four-minor jump was safe:
`ClerkProvider`, `useAuth`, `useUser`, `UserButton`, `SignIn`, `SignUp`, `RedirectToSignIn`,
and `<Show when="signed-in">`. No breaking change applied to any of them — the breaking wave
(`<Protect>`/`<SignedIn>`/`<SignedOut>` collapsing into `<Show>`, provider prop removals)
landed in 1.0.0, which we were already past.

Worth knowing:

- **We never used Clerk middleware for route protection**, which is what the critical
  advisory targeted, and we call none of the `has()` / `auth.protect()` predicates the
  authorization-bypass advisory targeted. The `/app` gate is the client-side
  `<Show when="signed-in">` in `src/routes/app.tsx`, and the *authoritative* check is always
  server-side in Convex (`requireRetailerAccess` / `requireOrderAccess` / `requireAdmin` in
  `convex/lib/auth.ts`). Blast radius was route-shell access, not tenant data.
- **The more relevant fix for us was the stored XSS also patched in 1.1.4**: Clerk was
  serializing auth state into SSR script tags without escaping `<`, `>` and `/`, exploitable
  via user-controllable session claims. We SSR with Clerk mounted, so this one was reachable.
- **`convex/auth.config.ts` is unaffected.** Token validation keys off
  `CLERK_JWT_ISSUER_DOMAIN` + `applicationID: "convex"` and is independent of the frontend
  SDK version.

### Why Clerk is exact-pinned, not caret-ranged

`@clerk/tanstack-react-start@1.5.0` raises its peer requirement to
`@tanstack/react-start ^1.167.17` / `@tanstack/react-router ^1.168.10`, to pair with a
TanStack-side fix that stops request middleware context being overridden during server
function execution. We pin react-start at **1.167.16** — one patch below — and pnpm installs
an unmet peer with nothing louder than a warning.

During this bump, a `^1.4.31` spec resolved straight to 1.5.0 and produced exactly that: an
auth SDK running against a framework version its own changelog says it needs a fix from. The
spec is therefore exact (`1.4.31`) and `@clerk/tanstack-react-start` was added to
`EXACT_PINNED` in `src/lib/dependency-pins.test.ts`. **Clerk 1.5.x is unblocked by, and
belongs to, the lockstep TanStack upgrade (86eyjadza)** — not a range that drifts on the
next unrelated `pnpm add`.
