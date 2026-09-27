import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AppImage } from "../ui/app-image";
import { SectionHeading } from "./section-heading";

/**
 * Brand-adjacent gradient fallbacks for categories without a tile image.
 * Picked deterministically from the slug so a category keeps its colour across
 * visits and pages. Full literal class strings (Tailwind JIT scans source).
 */
const FALLBACK_GRADIENTS = [
	"bg-gradient-to-br from-emerald-500 to-emerald-800",
	"bg-gradient-to-br from-sky-500 to-slate-800",
	"bg-gradient-to-br from-amber-400 to-orange-700",
	"bg-gradient-to-br from-violet-500 to-indigo-800",
	"bg-gradient-to-br from-rose-400 to-rose-700",
];

function gradientFor(slug: string): string {
	let hash = 0;
	for (let i = 0; i < slug.length; i++) {
		hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
	}
	return FALLBACK_GRADIENTS[hash % FALLBACK_GRADIENTS.length];
}

/**
 * The storefront's category tiles — image tiles with the category name and
 * its live product count under it. On mobile a horizontal snap-scroller
 * (86eybrhrt PR3, tightened to 124×84 in z8r3fdegb5 so the fold shows more
 * products); on desktop a 4-column grid of taller tiles directly under the
 * search bar (Arif's 12 Sep desktop-home-v2 — a wide screen has room to show
 * every door at once instead of hiding them in a scroller).
 *
 * The count moved from a floating top-right pill INTO the label block: it's a
 * fact about the name, not a badge on the photo.
 *
 * Renders NOTHING until categories resolve non-empty (the server already
 * excludes archived/hidden categories and any with zero visible products), so
 * zero-category stores are pixel-identical to the pre-categories storefront.
 *
 * Tiles are LINKS to the existing `/c/{slug}` pages, not client-side filters:
 * those routes keep their SSR/SEO and shareable deep links, and there's
 * exactly one navigation model.
 *
 * **Store home only.** It briefly also rendered on the category page with the
 * current tile ringed, for lateral hops (kuih → cakes); Zaki cut that (31 Jul)
 * — inside a category the page already names it, and T3 of z8r3fdegb5 gives
 * that page its own sibling CHIPS instead, which don't compete with the
 * products the way image tiles did.
 */
export function CategoryRail({
	retailerId,
	storeSlug,
}: {
	retailerId: Id<"retailers">;
	storeSlug: string;
}) {
	const categories = useQuery(
		convexQuery(api.categories.listActivePublic, { retailerId }),
	).data;
	if (!categories || categories.length === 0) return null;

	return (
		<section aria-label="Product categories" className="flex flex-col">
			<SectionHeading title="Browse by category" />
			{/* ONE list, layout-switched: a mobile snap scroller that becomes a
			    4-col grid at lg. Two parallel trees would double-fetch every tile
			    image (display:none still downloads), so the switch is pure CSS.
			    Scroller mechanics as the popular shelf: full-bleed so tiles slide
			    under the screen edge, `scroll-pl-*` tracking `px-*` so the snapped
			    rest position lines up with the search bar and grid (snap positions
			    measure from the padding box, not the content box). */}
			<div className="-mx-5 mt-2.5 flex snap-x scroll-pl-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-3.5 lg:overflow-visible lg:px-0 lg:pb-0">
				{categories.map((category) => {
					return (
						<Link
							key={category._id}
							to="/$slug/c/$categorySlug"
							params={{ slug: storeSlug, categorySlug: category.slug }}
							className="relative flex h-[84px] w-[124px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-[14px] transition-transform active:scale-[0.98] lg:h-[120px] lg:w-auto lg:rounded-2xl"
						>
							{category.imageUrl ? (
								<AppImage
									src={category.imageUrl}
									alt=""
									aspect="absolute inset-0"
									// Fixed 124px tiles on mobile; a quarter-row on desktop.
									sizes="(min-width: 1024px) 25vw, 124px"
								/>
							) : (
								<div
									aria-hidden
									className={`absolute inset-0 ${gradientFor(category.slug)}`}
								/>
							)}
							{/* Bottom-weighted scrim — the name stays legible on any art.
							    Heavy at the very bottom (a seller's photo can be pale — a
							    white-iced cake on marble left white-on-light); the top
							    stays near-clear so the photography still reads. */}
							<div
								aria-hidden
								className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent"
							/>
							<span className="relative flex flex-col p-2 lg:p-3">
								<span className="font-heading text-[13px] font-extrabold leading-tight tracking-tight text-white drop-shadow lg:text-base">
									{category.name}
								</span>
								<span className="text-[11px] leading-tight text-white/75 tabular-nums lg:text-xs lg:text-white/80">
									{category.productCount} item
									{category.productCount === 1 ? "" : "s"}
								</span>
							</span>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
