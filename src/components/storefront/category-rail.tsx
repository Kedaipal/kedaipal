import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Horizontally-scrolling category tiles for the storefront. Renders NOTHING
 * until categories resolve non-empty (the server already excludes archived
 * categories and any with zero visible products), so zero-category stores are
 * pixel-identical to today. Mounted on the store home AND on category pages
 * (`activeSlug` highlights the one being viewed, plus an "All" tile back to
 * the flat view — nothing is ever more than one tap from "everything").
 */
export function CategoryRail({
	retailerId,
	storeSlug,
	activeSlug,
}: {
	retailerId: Id<"retailers">;
	storeSlug: string;
	/** Slug of the category page being viewed; undefined on the store home. */
	activeSlug?: string;
}) {
	const categories = useQuery(api.categories.listActivePublic, { retailerId });
	if (!categories || categories.length === 0) return null;

	return (
		<nav aria-label="Product categories" className="mb-4">
			<div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden">
				{/* "All" tile only where it's a way BACK — the home page IS the all view. */}
				{activeSlug ? (
					<Link
						to="/$slug"
						params={{ slug: storeSlug }}
						className="flex h-[4.5rem] w-28 shrink-0 flex-col items-start justify-end gap-0.5 rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-accent/50"
					>
						<span className="text-[13px] font-semibold leading-tight">
							All products
						</span>
					</Link>
				) : null}
				{categories.map((category) => {
					const active = category.slug === activeSlug;
					return (
						<Link
							key={category._id}
							to="/$slug/c/$categorySlug"
							params={{ slug: storeSlug, categorySlug: category.slug }}
							aria-current={active ? "page" : undefined}
							className={`relative flex h-[4.5rem] w-28 shrink-0 flex-col items-start justify-end gap-0.5 overflow-hidden rounded-2xl border p-2.5 transition-colors ${
								active
									? "border-accent bg-accent/10"
									: "border-border bg-card hover:border-accent/50"
							}`}
						>
							{category.imageUrl ? (
								<>
									<img
										src={category.imageUrl}
										alt=""
										className="absolute inset-0 h-full w-full object-cover"
									/>
									{/* Bottom scrim keeps the name legible on any image. */}
									<div
										aria-hidden
										className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent"
									/>
								</>
							) : null}
							<span
								className={`relative line-clamp-2 text-[13px] font-semibold leading-tight ${
									category.imageUrl ? "text-white drop-shadow" : ""
								}`}
							>
								{category.name}
							</span>
							<span
								className={`relative text-[11px] leading-none ${
									category.imageUrl ? "text-white/85" : "text-muted-foreground"
								}`}
							>
								{category.productCount} item
								{category.productCount === 1 ? "" : "s"}
							</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
