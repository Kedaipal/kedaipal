// Settings → Bookings (booking bundle S6, `86eyn4kf2`): the Google-Calendar
// connect card. ONE-WAY ICS subscribe (locked 12 Aug) — Google polls the feed
// URL on its own schedule; the freshness caveat is stated in-card because a
// seller WILL compare the two calendars. The token is the whole capability,
// so rotate warns that the old URL dies (counter-QR precedent).

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { CalendarRange, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { clientEnv } from "../../lib/env";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";

/** Convex HTTP actions live on the `.convex.site` twin of the client's
 * `.convex.cloud` URL (the Lalamove webhook card's rule). */
function feedUrl(token: string): string {
	const convexUrl = clientEnv.VITE_CONVEX_URL ?? "";
	return `${convexUrl.replace(".convex.cloud", ".convex.site")}/cal/${token}.ics`;
}

export function BookingsTab({ retailerId }: { retailerId: Id<"retailers"> }) {
	const feed = useQuery(
		convexQuery(api.calendarFeed.getCalendarFeed, { retailerId }),
	).data;
	const ensureToken = useMutation(api.calendarFeed.ensureCalendarFeedToken);
	const rotateToken = useMutation(api.calendarFeed.rotateCalendarFeedToken);
	const [rotateOpen, setRotateOpen] = useState(false);
	const [rotating, setRotating] = useState(false);
	// One provision per mount — rendering the card must never rotate.
	const ensuredRef = useRef(false);

	useEffect(() => {
		if (!feed || feed.token !== null || !feed.hasBookingListings) return;
		if (ensuredRef.current) return;
		ensuredRef.current = true;
		void ensureToken({ retailerId }).catch(() => {
			// The card shows a provisioning state; a transient failure just
			// leaves it there and the next visit retries.
			ensuredRef.current = false;
		});
	}, [feed, ensureToken, retailerId]);

	if (feed === undefined) {
		return <Skeleton className="h-64 w-full rounded-2xl" />;
	}

	if (!feed.hasBookingListings) {
		return (
			<section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
				<CalendarRange className="size-8 text-muted-foreground" aria-hidden />
				<div>
					<p className="font-heading text-base font-bold">
						No booking listings yet
					</p>
					<p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
						This section holds the Google Calendar feed for listings sold by
						date. Create a product and pick the Booking kind first.
					</p>
				</div>
				<Button asChild variant="outline" className="tap-target">
					<Link to="/app/products/new">Create a booking listing</Link>
				</Button>
			</section>
		);
	}

	async function handleRotate() {
		setRotating(true);
		try {
			await rotateToken({ retailerId });
			toast.success(
				"New feed link created — re-subscribe in Google Calendar with it",
			);
			setRotateOpen(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setRotating(false);
		}
	}

	const url = feed.token ? feedUrl(feed.token) : null;

	return (
		<section className="flex flex-col gap-4 rounded-2xl border border-input bg-background p-5 lg:p-6">
			<div className="flex flex-col gap-1">
				<h3 className="font-heading text-base font-bold">
					See bookings in Google Calendar
				</h3>
				<p className="text-sm leading-relaxed text-muted-foreground">
					Subscribe Google Calendar (or any calendar app) to this private link
					and your approved stays — plus any days you&apos;ve blocked — appear
					as all-day events. It shows guest names and listings only, never phone
					numbers.
				</p>
			</div>

			{url ? (
				<div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2 pl-3">
					<span className="min-w-0 flex-1 truncate font-mono text-xs">
						{url}
					</span>
					<CopyButton
						value={url}
						ariaLabel="Copy calendar link"
						successMessage="Calendar link copied"
					/>
				</div>
			) : (
				<Skeleton className="h-11 w-full rounded-xl" />
			)}

			<ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
				<li>
					In Google Calendar, next to{" "}
					<span className="font-medium text-foreground">Other calendars</span>,
					tap <span className="font-medium text-foreground">+</span>
				</li>
				<li>
					Choose <span className="font-medium text-foreground">From URL</span>{" "}
					and paste the link above
				</li>
				<li>
					Tap <span className="font-medium text-foreground">Add calendar</span>{" "}
					— your bookings appear as &ldquo;Bookings — your store&rdquo;
				</li>
			</ol>

			<p className="rounded-xl bg-accent/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
				Google refreshes subscribed calendars on its own schedule — usually
				within a day. Your Kedaipal calendar (Orders → Calendar) is always live,
				so check there before accepting a walk-in for a busy night.
			</p>

			<div className="border-t border-border pt-3">
				<button
					type="button"
					onClick={() => setRotateOpen(true)}
					className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
				>
					<RefreshCw className="size-3.5" aria-hidden />
					Create a new link (the current one stops working)
				</button>
			</div>

			<Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create a new calendar link?</DialogTitle>
						<DialogDescription>
							The current link stops working immediately — Google Calendar will
							show the feed as unreachable until you re-subscribe with the new
							one. Do this if the link leaked or you shared it with someone who
							shouldn&apos;t have it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setRotateOpen(false)}
							disabled={rotating}
						>
							Keep current link
						</Button>
						<Button
							variant="destructive"
							isLoading={rotating}
							onClick={handleRotate}
						>
							Create new link
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
