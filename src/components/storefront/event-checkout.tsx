import { CalendarClock } from "lucide-react";
import { formatFulfilmentDateTime } from "../../../convex/lib/fulfilmentDate";
import type { ProductEvent } from "../../../convex/lib/productEvent";

/**
 * The two checkout surfaces an RSVP replaces (`z8r3fdff9u`), lifted out of
 * `checkout-form.tsx` so they can be rendered and looked at on their own — and
 * because a self-contained block with a name reads better than more inline JSX
 * in a 1700-line form.
 */

/**
 * The event lock, stated FIRST — above every checkout section.
 *
 * Adding an RSVP changes the terms of the WHOLE order: the date stops being the
 * buyer's to pick and delivery disappears. A buyer who also has two boxes of
 * cream puffs in the cart must be told that at the top, not left to notice a
 * missing date picker. The escape sits in the same card as the constraint.
 */
export function EventLockBanner({
	event,
	mixedCart,
	onRemove,
}: {
	event: ProductEvent;
	/** The cart also holds non-event lines, so the lock reaches beyond the RSVP. */
	mixedCart: boolean;
	onRemove: () => void;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent/5 p-4">
			<p className="flex items-center gap-2 text-sm font-semibold">
				<CalendarClock className="size-4 shrink-0 text-accent" aria-hidden />
				{/* The FULL spelling, not the storefront's glanceable badge: the
				    moment row sits on this same screen, and one date in two formats
				    400px apart is how a page starts looking like two pages. Browsing
				    is where brevity wins; this is where the buyer commits. */}
				RSVP for {formatFulfilmentDateTime(event.date, event.timeMinutes)}
			</p>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{mixedCart
					? "Everything in this order is collected together at the event — so there's no delivery option and no date to pick."
					: "Collected at the venue below — there's no delivery option and no date to pick."}
			</p>
			<button
				type="button"
				onClick={onRemove}
				className="tap-target w-fit text-xs font-semibold text-accent-emphasis underline underline-offset-2"
			>
				{mixedCart
					? "Remove the RSVP and order the rest normally"
					: "Remove the RSVP"}
			</button>
		</div>
	);
}

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
					{formatFulfilmentDateTime(event.date, event.timeMinutes)}
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Set by {storeName} for this event — the same for every guest.
				</p>
			</div>
		</div>
	);
}
