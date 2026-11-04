import { type ReactNode, useEffect } from "react";
import { useInView } from "react-intersection-observer";
import { cn } from "#/lib/utils";
import { Button } from "./button";

/**
 * The end of a cursor-paginated list, in one piece (Admin · Sellers, 4 Nov
 * 2026; built for `usePaginatedQuery`'s four statuses).
 *
 * - **It loads the next page by itself** once its zone comes within
 *   `rootMargin` of the viewport — the reader never meets a dead end mid-scroll.
 * - **The button stays.** A sentinel alone is invisible to a keyboard user and
 *   useless under reduced motion or with IntersectionObserver blocked; the
 *   button is the visible affordance and the fallback at once, and it tells the
 *   reader what a scroll would have done.
 * - **The end is named.** A list that just stops reads as a bug ("did it
 *   load?"); `exhaustedLabel` says what ran out — "That's every seller", "End
 *   of results for “kuih”".
 *
 * `useInView` is re-armed on every status change: Convex hands back a new
 * `loadMore` per page, so the effect re-runs without the zone ever leaving
 * view — which is what lets short, post-filtered pages chain until one fills.
 */
export type LoadMoreStatus =
	| "LoadingFirstPage"
	| "CanLoadMore"
	| "LoadingMore"
	| "Exhausted";

export interface LoadMoreSentinelProps {
	status: LoadMoreStatus;
	onLoadMore?: () => void;
	/** What to show while the next page loads — skeleton rows shaped like the
	 * list, never a lone spinner. */
	loadingSlot: ReactNode;
	exhaustedLabel: string;
	loadMoreLabel: string;
	/** One line under the button saying what happens ("Scroll or press to
	 * load the next 25"). */
	loadMoreHint?: string;
	className?: string;
}

const ROOT_MARGIN = "400px 0px";

export function LoadMoreSentinel({
	status,
	onLoadMore,
	loadingSlot,
	exhaustedLabel,
	loadMoreLabel,
	loadMoreHint,
	className,
}: LoadMoreSentinelProps) {
	const canLoad = status === "CanLoadMore";
	const { ref, inView } = useInView({
		rootMargin: ROOT_MARGIN,
		skip: !canLoad,
	});

	useEffect(() => {
		if (inView && canLoad) onLoadMore?.();
	}, [inView, canLoad, onLoadMore]);

	if (status === "LoadingFirstPage") return null;

	if (status === "LoadingMore") {
		return (
			<output
				aria-busy="true"
				aria-live="polite"
				className={cn("flex flex-col gap-2", className)}
			>
				{loadingSlot}
			</output>
		);
	}

	if (status === "Exhausted") {
		return (
			<p
				className={cn(
					"border-t border-border pt-4 text-center text-[13px] text-muted-foreground",
					className,
				)}
			>
				{exhaustedLabel}
			</p>
		);
	}

	return (
		<div
			ref={ref}
			className={cn(
				"flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-5 text-center",
				className,
			)}
		>
			<Button
				type="button"
				variant="outline"
				onClick={() => onLoadMore?.()}
				className="tap-target w-full rounded-xl px-5 lg:w-auto"
			>
				{loadMoreLabel}
			</Button>
			{loadMoreHint ? (
				<span className="text-xs text-muted-foreground">{loadMoreHint}</span>
			) : null}
		</div>
	);
}
