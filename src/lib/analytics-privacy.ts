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
 * True for the buyer routes whose *URL itself* is the secret.
 *
 * Two of them, and both are capability tokens with no auth behind them:
 *
 *  - `/track/<token>` — read the order, claim payment, edit the delivery
 *    address/phone (see CLAUDE.md).
 *  - `/claim/<token>` — read the buyer's name/phone and the frozen lines, and
 *    **write**: `orderClaims.commit` creates a real order and decrements the
 *    seller's stock. Strictly the stronger of the two.
 *
 * Any analytics tool that observes the page address on these routes exports
 * that secret to a third party, so both providers share this one predicate:
 * Clarity refuses to boot (`useClarity`), and GA neither initializes nor sends
 * (`useGoogleAnalytics`). For GA, exclusion beats redacting the sent path:
 * gtag auto-collects the full `page_location` from the browser once loaded, so
 * the library must never load here at all. Clarity hooks the History API on
 * init, so the same applies — plus a session replay of the buyer's checkout.
 *
 * Nothing links to either route client-side — buyers always arrive from a
 * WhatsApp link, i.e. a fresh document load — so refusing to boot here is a
 * complete exclusion, not a partial one.
 *
 * ADD ANY NEW TOKEN-IN-URL BUYER ROUTE HERE. `/claim` was missed when it
 * shipped (PR #227 review) even though the route was correctly added to
 * `BUYER_ROUTE_IDS` for the Clerk-off list — the two lists guard the same
 * class of route and are worth changing together.
 */
export function isCapabilityTokenPath(pathname: string): boolean {
	return CAPABILITY_TOKEN_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

const CAPABILITY_TOKEN_PREFIXES = ["/track", "/claim"] as const;
