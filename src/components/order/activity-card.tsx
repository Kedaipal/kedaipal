import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import type { FunctionReturnType } from "convex/server";
import { History } from "lucide-react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatOrderTimestamp } from "../../lib/format";
import { Button } from "../ui/button";

/**
 * Order activity (86exr91r4) — the seller-side event timeline, and the home
 * of attribution: with teammates in the store, "who confirmed this?" is a
 * real question, and this card answers it ("by Aina", "by you", "by the
 * owner"). Events without an actor are buyer- or system-originated and say
 * nothing rather than guessing. Removed teammates still resolve by name —
 * their membership row is kept for exactly this. Newest first, collapsed to
 * the recent few so the card informs without swallowing the page.
 */

type TimelineEvent = FunctionReturnType<typeof api.orders.getTimeline>[number];

const STATUS_LABEL: Record<TimelineEvent["status"], string> = {
	pending: "Order placed",
	booking_requested: "Booking requested",
	confirmed: "Confirmed",
	packed: "Packed",
	shipped: "Shipped",
	delivered: "Delivered",
	cancelled: "Cancelled",
};

const COLLAPSED_COUNT = 5;

export function ActivityCard({ orderId }: { orderId: Id<"orders"> }) {
	const events = useQuery(
		convexQuery(api.orders.getTimeline, { orderId }),
	).data;
	const [expanded, setExpanded] = useState(false);

	if (!events || events.length === 0) return null;
	const visible = expanded ? events : events.slice(0, COLLAPSED_COUNT);
	const hidden = events.length - COLLAPSED_COUNT;

	return (
		<section className="rounded-2xl border border-border bg-card p-4">
			<h3 className="flex items-center gap-2 font-heading text-sm font-extrabold">
				<History className="size-4 text-muted-foreground" /> Activity
			</h3>
			<ol className="mt-3 flex flex-col">
				{visible.map((event, i) => (
					<li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
						{/* Rail: dot + connecting line (skipped after the last row). */}
						<span
							aria-hidden="true"
							className="flex flex-col items-center pt-1"
						>
							<span
								className={`size-2 shrink-0 rounded-full ${i === 0 ? "bg-accent" : "bg-border"}`}
							/>
							{i < visible.length - 1 ? (
								<span className="mt-1 w-px flex-1 bg-border" />
							) : null}
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium leading-tight">
								{event.stageLabel ?? STATUS_LABEL[event.status]}
							</p>
							<p className="text-xs text-muted-foreground">
								{formatOrderTimestamp(event.createdAt)}
								{event.actor
									? ` · by ${event.actor.you ? "you" : event.actor.name}`
									: ""}
							</p>
							{event.note ? (
								<p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground/80">
									{event.note}
								</p>
							) : null}
						</div>
					</li>
				))}
			</ol>
			{hidden > 0 && !expanded ? (
				<Button
					variant="ghost"
					size="sm"
					className="mt-1 w-full text-xs"
					onClick={() => setExpanded(true)}
				>
					Show {hidden} earlier {hidden === 1 ? "event" : "events"}
				</Button>
			) : null}
		</section>
	);
}
