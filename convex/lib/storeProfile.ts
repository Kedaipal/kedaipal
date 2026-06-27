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

// Public storefront store description cap. Short by design — a one-to-three-line
// trust signal under the store name, not a full About page.
export const STORE_DESCRIPTION_MAX = 280;
