import { Skeleton } from "../ui/skeleton";

/**
 * One skeleton that mirrors the final zones (z8r3fdrgzj).
 *
 * Deliberately shaped like the page rather than a generic stack of bars: Home
 * decides its whole layout from `products` and the subscription, so a skeleton
 * that does not reserve the right blocks produces a visible jump the moment
 * they resolve. Greeting, strip, hero, then cards — the same order, the same
 * rough heights.
 */
export function HomeSkeleton() {
	return (
		<div className="flex flex-col gap-6 lg:gap-8">
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-3.5 w-32" />
				<Skeleton className="h-7 w-56" />
			</div>
			<div className="grid grid-cols-[1fr_1fr_1.3fr] gap-2">
				<Skeleton className="h-[104px] rounded-[18px]" />
				<Skeleton className="h-[104px] rounded-[18px]" />
				<Skeleton className="h-[104px] rounded-[18px]" />
			</div>
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Skeleton className="h-6 w-20" />
					<div className="ml-auto flex gap-1.5">
						<Skeleton className="h-10 w-20 rounded-full" />
						<Skeleton className="h-10 w-20 rounded-full" />
						<Skeleton className="h-10 w-20 rounded-full" />
					</div>
				</div>
				<Skeleton className="h-[360px] rounded-3xl" />
			</div>
			<Skeleton className="h-52 rounded-2xl" />
			<Skeleton className="h-44 rounded-2xl" />
		</div>
	);
}
