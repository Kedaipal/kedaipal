/**
 * The one place a "coloured status chip" gets its classes (z8r3fdadub).
 *
 * WHY THIS EXISTS: the same `bg-X-100 text-X-800` shape was hand-copied into
 * four unrelated files — subscription status (`app.admin.sellers.tsx`), billing
 * status (`app.admin.billing.tsx`), the buyer's order status (`track.$token.tsx`)
 * and mockup status (`app.orders.$shortId.tsx`). Four copies of a colour map
 * drift on the first addition, and dark mode proved it: three of the four had no
 * `dark:` pairs at all, so a buyer's order-status pill was dark-on-dark while the
 * seller's identical pill was fine. Same failure the order CSV column registry
 * was built to prevent — one list, many consumers.
 *
 * NOT EVERY COPY COULD MOVE, and that is on purpose. `app.admin.billing.tsx`
 * keeps its two maps hand-rolled because its light values genuinely differ from
 * these (`text-X-800` where the panels use `-700`, `-700` where the chips use
 * `-800`), and repainting a surface in light was not on this ticket's menu.
 * Migrating only the rows that happened to match would leave a map that is half
 * registry and half literal — which is the exact drift this module exists to
 * stop, so partial adoption is worse than none. Same reason `trialing` stays raw
 * sky in `app.admin.sellers.tsx`: sky-800 is not blue-800.
 *
 * `dashboard/status-badge.tsx` also predates this and is already correct in both
 * themes; it is left alone rather than churned.
 *
 * WHAT THIS IS NOT: a semantic status registry. Each domain keeps its own
 * meaning→tone mapping next to the domain (a "packed" order and an "overdue"
 * invoice are both amber for different reasons, and merging those maps would
 * couple two things that should be free to diverge). This module owns only the
 * question "given a tone, what classes make it readable in BOTH themes".
 *
 * The dark values are the 950/2xx-3xx pairs the dashboard status badges already
 * settled on (`status-badge.tsx`), so a chip added here matches the ones that
 * shipped before dark mode existed.
 */

export type Tone =
	| "neutral"
	| "success"
	| "warn"
	| "info"
	| "danger"
	| "pending"
	| "progress";

/** Filled pill: coloured background + readable text. The common case. */
export const TONE_CHIP: Record<Tone, string> = {
	neutral: "bg-muted text-muted-foreground",
	success:
		"bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
	warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
	info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
	danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
	pending:
		"bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
	progress:
		"bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
};

/**
 * Outlined panel: tinted surface + hairline + body text. For notice cards.
 *
 * The LIGHT half is copied verbatim from the buyer's payment card on
 * `track.$token.tsx`, which is where the first consumer came from. That is not
 * an accident and it is not free to change: adopting this registry must never
 * repaint a surface in the theme 100% of today's users are actually in, so the
 * light values here are the ones that already shipped, per-hue quirks included
 * (amber sits a step darker than emerald/blue because amber-700 on amber-50 is
 * too faint). Only the `dark:` half is new.
 */
export const TONE_PANEL: Record<Tone, string> = {
	neutral: "border-border bg-muted/50 text-foreground",
	success:
		"border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
	warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100",
	info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-100",
	danger:
		"border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100",
	pending:
		"border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-100",
	progress:
		"border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950/50 dark:text-purple-100",
};

/** The glyph / eyebrow colour that sits on a TONE_PANEL. */
export const TONE_ACCENT: Record<Tone, string> = {
	neutral: "text-muted-foreground",
	success: "text-emerald-700 dark:text-emerald-300",
	warn: "text-amber-700 dark:text-amber-300",
	info: "text-blue-700 dark:text-blue-300",
	danger: "text-red-700 dark:text-red-300",
	pending: "text-orange-700 dark:text-orange-300",
	progress: "text-purple-700 dark:text-purple-300",
};
