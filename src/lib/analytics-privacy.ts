/**
 * Marks a DOM subtree as personally identifiable so session-replay tools mask
 * its text.
 *
 * Microsoft Clarity's default masking mode is **Balanced**, which masks only
 * numbers, email addresses, and the contents of `input`/`select` elements —
 * every other *rendered* string is captured verbatim. That leaves buyer names,
 * the non-numeric parts of delivery addresses, order notes, and the seller's
 * private customer notes exposed in replays.
 *
 * `data-clarity-mask="true"` overrides the dashboard setting for that subtree,
 * which keeps the rule in the repo where review can see it rather than behind
 * an out-of-band toggle nobody can diff.
 *
 * Spread it onto the outermost element of any region that renders buyer or
 * customer PII:
 *
 * ```tsx
 * <section {...MASK_PII} className="...">…</section>
 * ```
 *
 * Grep for `MASK_PII` to audit coverage. New surfaces that render a customer's
 * name, phone, address, or notes must carry it.
 */
export const MASK_PII = { "data-clarity-mask": "true" } as const;

/**
 * True for the buyer order-tracking routes, whose *URL itself* is the secret.
 *
 * `/track/<token>` carries the buyer's capability token — it grants reading
 * the order, claiming payment, and editing the delivery address/phone with no
 * auth (see CLAUDE.md). Any analytics tool that observes the page address on
 * these routes exports that secret to a third party, so both providers share
 * this one predicate: Clarity refuses to boot (`useClarity`), and GA neither
 * initializes nor sends (`useGoogleAnalytics`). For GA, exclusion beats
 * redacting the sent path: gtag auto-collects the full `page_location` from
 * the browser once loaded, so the library must never load here at all.
 *
 * Nothing links to `/track` client-side — buyers always arrive from a WhatsApp
 * link, i.e. a fresh document load — so refusing to boot here is a complete
 * exclusion, not a partial one.
 */
export function isTrackingTokenPath(pathname: string): boolean {
	return pathname === "/track" || pathname.startsWith("/track/");
}
