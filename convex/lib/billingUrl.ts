/**
 * The seller's Settings → Billing page — the one spelling every billing email,
 * balance notice and HitPay redirect links to (it was hand-built in four
 * places). `extra` appends one query pair the billing tab reads on arrival:
 * `topup=1` opens the credit-pack picker and `topup=return` lands back from a
 * pack checkout (the contract in src/lib/credit-top-up.ts); `paid=return` and
 * `autorenew=return` come back from an invoice checkout and the auto-renewal
 * authorisation.
 */
export function billingPageUrl(extra?: string): string {
	const base = `${process.env.SITE_URL ?? "https://kedaipal.com"}/app/settings?tab=billing`;
	return extra ? `${base}&${extra}` : base;
}
