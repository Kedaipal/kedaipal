/**
 * Shared limits for the retailer's public storefront profile fields.
 *
 * Single source of truth imported by BOTH the Convex mutation
 * (`convex/retailers.ts`, server-enforced) and the settings UI
 * (`src/routes/app.settings.tsx`, `maxLength` + live counter). Kept free of
 * Convex/server imports so it bundles cleanly into the frontend — same pattern
 * as `convex/lib/currency.ts`. Do NOT mirror this into `src/lib`; import it
 * directly so the cap can never drift between client and server.
 */

// Public storefront store description cap. Short by design — a two-line trust
// signal under the store name (the storefront header clamps it to 2 rows), not a
// full About page. Kept tight so it never crowds out the products, especially
// over a cover image where it sits on a scrim.
export const STORE_DESCRIPTION_MAX = 150;
