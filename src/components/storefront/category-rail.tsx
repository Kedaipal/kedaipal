import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AppImage } from "../ui/app-image";

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
 * The storefront's category carousel — image tiles with the category name and
 * its live product count, in a horizontal snap-scroller (86eybrhrt PR3).
 *
 * This is the design's Direction-A category treatment at a **smaller** size
 * (Zaki, 31 Jul). PR3 first replaced the original full-size rail with text
 * chips, because tiles at `h-[9.5rem] w-[15rem]` dominated the fold on a
 * ≤3-category store; shrinking them to ~a third of that area keeps the
 * photography — which is the whole point for a food seller — without pushing
 * the products under. Tile images already existed in the data and dashboard;
 * this puts them back on the storefront.
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
 * and it's the right call — inside a category the page already names it and
 * the only job left is browsing what's in it, so a row of siblings just
 * competes with the products it sits on top of. "← All products" is the way
 * back out.
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
			<p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
				Browse by category
			</p>
			{/* Same scroller mechanics as the popular shelf: full-bleed so tiles
			    slide under the screen edge, with `scroll-pl-*` tracking `px-*` so
			    the snapped rest position still lines up with the search bar and
			    grid (snap positions measure from the padding box, not the content
			    box — without it the first tile parks against the screen edge). */}
			<div className="-mx-5 mt-2 flex snap-x scroll-pl-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:-mx-8 lg:scroll-pl-8 lg:px-8 [&::-webkit-scrollbar]:hidden">
				{categories.map((category) => {
					return (
						<Link
							key={category._id}
							to="/$slug/c/$categorySlug"
							params={{ slug: storeSlug, categorySlug: category.slug }}
							className="relative flex h-24 w-36 shrink-0 snap-start flex-col justify-end overflow-hidden rounded-xl transition-transform active:scale-[0.98] lg:h-28 lg:w-44"
						>
							{category.imageUrl ? (
								<AppImage
									src={category.imageUrl}
									alt=""
									aspect="absolute inset-0"
									// Fixed-width tiles, so a fixed hint: w-36 (144px)
									// growing to lg:w-44 (176px).
									sizes="176px"
								/>
							) : (
								<div
									aria-hidden
									className={`absolute inset-0 ${gradientFor(category.slug)}`}
								/>
							)}
							{/* Bottom-weighted scrim — the name stays legible on any art.
							    Heavier at the very bottom than the old full-size rail:
							    these tiles are ~a third the area with 13px text, and a
							    seller's photo can be pale (a white-iced cake on marble),
							    which left white-on-light. The top stays near-clear so the
							    photography still reads. */}
							<div
								aria-hidden
								className="absolute inset-0 bg-gradient-to-t from-primary/90 via-primary/30 to-transparent"
							/>
							<span className="absolute right-2 top-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary">
								{category.productCount}
							</span>
							<span className="relative p-2.5 font-heading text-[13px] font-extrabold leading-tight tracking-tight text-white drop-shadow lg:text-[15px]">
								{category.name}
							</span>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
