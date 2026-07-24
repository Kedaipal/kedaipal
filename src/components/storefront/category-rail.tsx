import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Img } from "../ui/image";

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
 * The store home's category hero — the categories ARE the menu: big tappable
 * image cards in a snap carousel under a "Browse by category" heading, closed
 * by an "All products" divider that labels the full grid below.
 *
 * Renders NOTHING until categories resolve non-empty (the server already
 * excludes archived/hidden categories and any with zero visible products), so
 * zero-category stores are pixel-identical to the pre-categories storefront.
 */
export function CategoryRail({
	retailerId,
	storeSlug,
}: {
	retailerId: Id<"retailers">;
	storeSlug: string;
}) {
	const categories = useQuery(api.categories.listActivePublic, { retailerId });
	if (!categories || categories.length === 0) return null;

	return (
		<nav aria-label="Product categories" className="flex flex-col">
			<h2 className="font-heading text-lg font-extrabold leading-tight tracking-tight">
				Browse by category
			</h2>
			<div className="-mx-5 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden">
				{categories.map((category) => (
					<Link
						key={category._id}
						to="/$slug/c/$categorySlug"
						params={{ slug: storeSlug, categorySlug: category.slug }}
						className="relative flex h-[9.5rem] w-[15rem] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl transition-transform active:scale-[0.98] sm:w-[17rem] lg:h-[11rem] lg:w-[19rem]"
					>
						{category.imageUrl ? (
							<Img
								src={category.imageUrl}
								alt=""
								wrapperClassName="absolute inset-0"
							/>
						) : (
							<div
								aria-hidden
								className={`absolute inset-0 ${gradientFor(category.slug)}`}
							/>
						)}
						{/* Bottom-weighted scrim — name/description stay legible on any art. */}
						<div
							aria-hidden
							className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/20 to-transparent"
						/>
						<span className="absolute right-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-bold text-primary">
							{category.productCount} item
							{category.productCount === 1 ? "" : "s"}
						</span>
						<div className="relative flex flex-col gap-0.5 p-3.5 text-white">
							<span className="font-heading text-[17px] font-extrabold leading-tight tracking-tight drop-shadow">
								{category.name}
							</span>
							{category.description ? (
								<span className="line-clamp-2 text-[11.5px] leading-snug text-white/90">
									{category.description}
								</span>
							) : null}
						</div>
					</Link>
				))}
			</div>
			{/* Labels the full grid below — everything stays one scroll away. */}
			<div className="flex items-center gap-3 pb-1 pt-5" aria-hidden>
				<span className="h-px flex-1 bg-border" />
				<span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
					All products
				</span>
				<span className="h-px flex-1 bg-border" />
			</div>
		</nav>
	);
}
