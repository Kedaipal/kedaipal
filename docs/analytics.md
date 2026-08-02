# Analytics

**Status: implemented.** Client-side web analytics for the whole app —
storefront _and_ the seller dashboard. Two independent, env-gated providers,
each booted once from a hook mounted in the root document. Both no-op unless
their project/measurement ID env var is set, so local dev and preview builds
never pollute the production analytics.

| Tool                  | What it's for                          | Package         | Hook                                                 | Env var                   |
| --------------------- | -------------------------------------- | --------------- | ---------------------------------------------------- | ------------------------- |
| Google Analytics 4    | Pageviews, traffic, acquisition        | `react-ga4`     | [`useGoogleAnalytics`](../src/hooks/useGoogleAnalytics.ts) | `VITE_GA_MEASUREMENT_ID`  |
| Microsoft Clarity     | Session replays + heatmaps (UX/friction) | `@microsoft/clarity` | [`useClarity`](../src/hooks/useClarity.ts)      | `VITE_CLARITY_PROJECT_ID` |

Both hooks are called in `RootDocument` ([`src/routes/__root.tsx`](../src/routes/__root.tsx)),
so analytics load on every route (storefront + `/app`). ClickUp `86eyb7021`
(Clarity).

## Why the npm package, not a `<script>` snippet

Clarity's dashboard offers a raw `<script>` tag, but we use the official
`@microsoft/clarity` package instead — matching the existing GA setup
(`react-ga4`). This keeps the project ID **env-driven** (no ID hardcoded into
committed HTML, and dev/preview stay out of the Clarity project by default),
runs on the client via `useEffect` so it's SSR-safe under TanStack Start, and
exposes a typed API (`identify`, `setTag`, `event`) if we later want to tag
sessions by seller or plan.

## How it works

`useClarity` initializes Clarity exactly once per page load:

```ts
const projectId = clientEnv.VITE_CLARITY_PROJECT_ID;
if (!projectId || clarityInitialized) return;
Clarity.init(projectId);
```

Unlike GA — where `useGoogleAnalytics` fires a pageview on every pathname change
— Clarity needs no per-navigation call: after `init` it hooks the History API
and tracks SPA route changes itself. The module-level `clarityInitialized` guard
mirrors GA's `gaInitialized`, so a remount (or React StrictMode's double effect
in dev) can't double-boot it.

## Configuration

- **Local:** copy the `VITE_CLARITY_PROJECT_ID` line from `.env.local.example`
  into `.env.local`. Leave it blank to keep local traffic out of Clarity; set it
  to `xoduz9wjl5` (the Kedaipal project) only if you want to test the boot.
- **Production:** `VITE_` vars are baked at build time. The build step in
  [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) reads
  `VITE_CLARITY_PROJECT_ID` from the GitHub Actions **`prod` environment
  variables** (same as `VITE_GA_MEASUREMENT_ID`). Add `VITE_CLARITY_PROJECT_ID =
  xoduz9wjl5` there (Settings → Environments → prod → variables) or prod builds
  ship without Clarity.

The Clarity project ID is not a secret — it's embedded in the shipped client
HTML on every page — so it lives in a plaintext repo variable, not a secret.

## Privacy

Clarity records session replays, which is more invasive than pageview analytics,
so it's disclosed as a data processor in the
[privacy policy](../src/routes/privacy.tsx). Text and input masking is governed
by the masking settings in the Clarity dashboard (keep the default
mask-sensitive-content on — the seller dashboard shows customer PII and order
data).
