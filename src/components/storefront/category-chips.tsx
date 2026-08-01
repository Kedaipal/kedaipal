import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Category navigation as a light filter-chip row (86eybrhrt PR3) — replaces
 * the image-tile CategoryRail carousel. The rail's big hero cards were heavy
 * for the typical ≤3-category store and pushed the products (the actual
 * inventory) below the fold; chips keep categories one tap away while the
 * grid leads.
 *
 * The chips are LINKS to the existing category pages, not client-side
 * filters: the `/c/{slug}` routes keep their SSR/SEO and shareable deep
 * links (the dashboard's per-category copy-link still lands somewhere real),
 * and there's exactly one navigation model. The category page renders the
 * same row with its own chip active, so buyers can hop laterally
 * (kuih → cakes) without going through "back".
 *
 * Renders NOTHING until categories resolve non-empty (the server already
 * excludes archived/hidden categories and any with zero visible products), so
 * zero-category stores are pixel-identical to the pre-categories storefront.
 * Category tile images still exist in the data + dashboard — they're just no
 * longer a storefront surface.
 */
export function CategoryChips({
	retailerId,
	storeSlug,
	activeCategorySlug,
}: {
	retailerId: Id<"retailers">;
	storeSlug: string;
	/** Set on the category page — that chip renders active; on the store home
	 * (unset) the "All" chip is active. */
	activeCategorySlug?: string;
}) {
	const categories = useQuery(api.categories.listActivePublic, { retailerId });
	if (!categories || categories.length === 0) return null;

	const chipClass = (active: boolean) =>
		`flex h-11 shrink-0 snap-start items-center rounded-full border px-4 text-sm font-semibold transition-colors ${
			active
				? "border-accent bg-accent/10 text-accent-emphasis"
				: "border-border bg-card text-foreground hover:border-accent/50"
		}`;

	return (
		<nav
			aria-label="Product categories"
			// Full-bleed scroll row on mobile (parent section pads px-5 / lg:px-8).
			className="-mx-5 mb-4 flex snap-x gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden"
		>
			{/* `exact` is load-bearing, not decoration. TanStack Router matches
			    prefixes by default and sets `aria-current="page"` ITSELF on any
			    link it considers active — so on /herb/c/cakes the store-home link
			    (/herb, a prefix) was announced as the current page alongside the
			    real one, overriding the `undefined` below. Screen readers heard two
			    current pages; the styling was right, which is why it looked fine. */}
			<Link
				to="/$slug"
				params={{ slug: storeSlug }}
				activeOptions={{ exact: true }}
				aria-current={activeCategorySlug ? undefined : "page"}
				className={chipClass(!activeCategorySlug)}
			>
				All
			</Link>
			{categories.map((category) => {
				const active = category.slug === activeCategorySlug;
				return (
					<Link
						key={category._id}
						to="/$slug/c/$categorySlug"
						params={{ slug: storeSlug, categorySlug: category.slug }}
						aria-current={active ? "page" : undefined}
						className={chipClass(active)}
					>
						{category.name}
					</Link>
				);
			})}
		</nav>
	);
}
