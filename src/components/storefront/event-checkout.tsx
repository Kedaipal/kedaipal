import { CalendarClock } from "lucide-react";
import {
	formatEventMoment,
	type ProductEvent,
} from "../../../convex/lib/productEvent";

/**
 * The event's moment, read back on the standalone RSVP checkout
 * (`event-rsvp-checkout-form.tsx`).
 *
 * Was one of a pair: `EventLockBanner` announced that an RSVP had taken over
 * a shared cart's date and venue, with a one-tap escape. That banner is gone
 * with the mix it explained (`z8r3fdhh45`) — an RSVP is its own order now, so
 * there is no longer anything for it to warn about.
 */

/**
 * The fulfilment step, answered rather than asked.
 *
 * A read-back, not a disabled date picker — a greyed-out control still reads as
 * a choice the buyer is failing to make.
 */
export function EventMomentRow({
	event,
	storeName,
}: {
	event: ProductEvent;
	storeName: string;
}) {
	return (
		<div className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/50 px-3 py-3">
			<CalendarClock className="size-5 shrink-0 text-accent" aria-hidden />
			<div className="min-w-0">
				<p className="text-sm font-semibold leading-tight">
					{formatEventMoment(event)}
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Set by {storeName} for this event — the same for every guest.
				</p>
			</div>
		</div>
	);
}
