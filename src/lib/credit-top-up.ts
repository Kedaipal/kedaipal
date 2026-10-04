/**
 * The URL contract for the credit-pack picker (Credits T2, z8r3fdf8ht).
 *
 *  - `/app/settings?tab=billing&topup=1` OPENS the picker. Every "Top up"
 *    button in the app links here (the credit meter and lock surfaces, T3) —
 *    with `TOP_UP_SEARCH` on a router `<Link>`, or `TOP_UP_HREF` as a plain
 *    path, rather than spelling the params.
 *  - `/app/settings?tab=billing&topup=return` is where HitPay's checkout sends
 *    the buyer back (`creditPurchases.createTopUp` mints it): the picker
 *    reopens on "Confirming your payment…" and reconciles.
 *
 * Both are consumed once and stripped from the URL, so a refresh or a shared
 * link never replays a payment confirmation.
 */

/** `?topup=` exactly as it appears in the URL: `1` opens the picker,
 * `return` is the way back from HitPay. The validated search carries the raw
 * value, so a typed `<Link search={TOP_UP_SEARCH}>` produces `topup=1`. */
export type TopUpParam = 1 | "return";

/** Search params that open the picker on the billing tab. */
export const TOP_UP_SEARCH = { tab: "billing", topup: 1 } as const;

/** The same, as a plain path — for anchors and emails. */
export const TOP_UP_HREF = "/app/settings?tab=billing&topup=1";

/** Validate `?topup=`. TanStack's search parser JSON-decodes values, so a
 * typed URL's `topup=1` arrives as the NUMBER 1 — and a hand-built link's
 * quoted "1" as the string; both open the picker. Anything else is dropped,
 * so a hand-typed value can't trigger a reconcile. */
export function parseTopUpParam(raw: unknown): TopUpParam | undefined {
	if (raw === 1 || raw === "1") return 1;
	if (raw === "return") return "return";
	return undefined;
}
