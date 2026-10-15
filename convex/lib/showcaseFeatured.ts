import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { SHOWCASE_SCAN_CAP, showcaseState } from "./showcase";

/**
 * The seller's side of showcases (z8r3fdr6mv): which published showcases a
 * store is in, for the Settings → Store → Marketplace listing card. A lib
 * helper, not part of `convex/showcases.ts`, because `marketplace.ts` serves
 * it (`myListingReadiness`) while `showcases.ts` reads `marketplace.ts`'s
 * listable rule — keeping it here leaves no import cycle between the two.
 */

export type FeaturedIn = {
	slug: string;
	title: string;
	label?: string;
	endsAt?: number;
	startsAt?: number;
	/** `live` or `scheduled` — ended and draft showcases are not reported. */
	state: "live" | "scheduled";
};

/**
 * The published showcases this store is in, for the seller's settings card:
 * the no-hidden-behaviour rule means a seller must be able to see that
 * Kedaipal put them in a showcase, with the label it gave them. Drafts stay
 * private to the admin — a half-built showcase is not a promise.
 */
export async function featuredIn(
	ctx: QueryCtx,
	retailerId: Id<"retailers">,
	now: number,
): Promise<FeaturedIn[]> {
	const rows = await ctx.db
		.query("marketplaceShowcases")
		.withIndex("by_sortOrder")
		.order("asc")
		.take(SHOWCASE_SCAN_CAP);
	const out: FeaturedIn[] = [];
	for (const row of rows) {
		const state = showcaseState(row, now);
		if (state !== "live" && state !== "scheduled") continue;
		const member = row.members.find((m) => m.retailerId === retailerId);
		if (!member) continue;
		out.push({
			slug: row.slug,
			title: row.title,
			label: member.label,
			endsAt: row.endsAt,
			startsAt: row.startsAt,
			state,
		});
	}
	return out;
}
