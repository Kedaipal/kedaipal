import { Link } from "@tanstack/react-router";
import { ChevronRight, Store } from "lucide-react";

/**
 * The order page's ways back into the store it came from (z8r3fducgw).
 *
 * The order page is where every order lands (the confirmation message's only
 * link), and it used to be a dead end: the store name was plain text and the
 * only link out was Kedaipal's seller landing page. A buyer who forgot
 * something had to dig the store link out of WhatsApp. Two exits now, both the
 * SELLER's store: the store-name eyebrow at the top, and a "Continue shopping"
 * row at the foot. Other stores ("Discover more stores") come after, in the
 * footer: the seller's own store is always the first way out.
 */

/** The slug to link back to, or undefined when there is no store to go back
 * to: the store is gone (no slug), or Kedaipal took it offline, where its
 * storefront is only the neutral "isn't available" page. A PAUSED store still
 * links back: its storefront renders browse-only and says why. */
export function storeLinkSlug(order: {
	retailerSlug?: string;
	storeOffline?: boolean;
}): string | undefined {
	return order.storeOffline === true ? undefined : order.retailerSlug;
}

/** A declined or expired booking/RSVP request card carries its own link back
 * ("Try different dates" / "Back to {store}"), so the foot row would only
 * double it. */
export function requestCardLinksBack(order: {
	bookingResolution?: string;
}): boolean {
	return order.bookingResolution !== undefined;
}

/** The page's eyebrow: the store name, tappable back to its storefront. Same
 * tab, it is the seller's own store. Plain text when there is nowhere to go. */
export function OrderStoreEyebrow({
	storeName,
	slug,
	ms,
}: {
	storeName: string;
	slug: string | undefined;
	ms: boolean;
}) {
	const textClass =
		"truncate text-xs font-semibold uppercase tracking-widest text-accent";
	if (!storeName || !slug) {
		return (
			<p className={textClass}>
				{storeName || (ms ? "Pesanan anda" : "Your order")}
			</p>
		);
	}
	return (
		<Link
			to="/$slug"
			params={{ slug }}
			aria-label={ms ? `Ke kedai ${storeName}` : `Go to ${storeName}`}
			// Negative-margin/padding pairs: a 44px hit area (16 + 16px text + 12)
			// without moving anything. Lopsided on purpose — the heading sits
			// 12px below (`mt-3`), so the bottom pad stops exactly where
			// `#ORD-XXXX` starts: a buyer long-pressing to copy the order number
			// must not land on this link. Above is the page's 40px top padding.
			className="group -mt-4 -mb-3 inline-flex max-w-full items-center gap-0.5 self-start rounded-md pt-4 pb-3 transition-colors hover:text-accent-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
		>
			<span className={textClass}>{storeName}</span>
			<ChevronRight
				aria-hidden
				className="size-3.5 shrink-0 text-accent transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
			/>
		</Link>
	);
}

/** The foot-of-page row back into the store. Sits with "Message the store",
 * below every payment and status card, never beside a Pay CTA. */
export function ContinueShoppingLink({
	storeName,
	slug,
	ms,
}: {
	storeName: string;
	slug: string;
	ms: boolean;
}) {
	return (
		<Link
			to="/$slug"
			params={{ slug }}
			className="flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
		>
			<Store aria-hidden className="size-4 shrink-0" />
			{/* Wraps, never truncates: the store's NAME is the point of this
			    row, and "Continue shopping at TrailGear Malaysia" already fills a
			    375px phone — a 360px one would cut it to "TrailGear Malays…". */}
			<span className="min-w-0 text-center text-balance break-words">
				{ms
					? `Teruskan membeli di ${storeName}`
					: `Continue shopping at ${storeName}`}
			</span>
		</Link>
	);
}
