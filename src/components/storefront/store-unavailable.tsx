import { Link } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { Button } from "../ui/button";

/**
 * A store Kedaipal has taken offline (`z8r3fdudf7`) — what every buyer route
 * renders in place of the storefront, product, category and checkout pages.
 *
 * NEUTRAL by rule: never "suspended", "closed down" or "unpaid" (the
 * `lib/buyerPayments.ts` posture — a buyer is not told a store's business).
 * It names the store so a buyer who followed a link knows they reached the
 * right place, and gives them somewhere to go next. A buyer with an order
 * already placed still has their tracking link; that page is never affected.
 *
 * `noindex` is rendered here (React 19 hoists it into <head>) so an offline
 * store drops out of search the same way it drops off /stores and the
 * sitemap.
 */
export function StoreUnavailable({ storeName }: { storeName: string }) {
	return (
		<main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
			<meta name="robots" content="noindex, nofollow" />
			<div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
				<Store className="size-6 text-muted-foreground" aria-hidden />
			</div>
			<h1 className="font-heading text-2xl font-extrabold leading-tight">
				{storeName} isn't available right now
			</h1>
			<p className="text-sm text-muted-foreground">
				Please check back later. If you've already placed an order, the link the
				store sent you still shows its progress.
			</p>
			<Button asChild className="tap-target mt-2">
				<Link to="/stores">Browse other stores</Link>
			</Button>
		</main>
	);
}
