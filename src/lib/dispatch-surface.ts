/**
 * What a booking provider has to show on one order (86eyjpv6z, 3 Sep).
 *
 * Both dispatch cards decide for themselves whether to render — and the
 * dispatch hub needs the SAME answer before it offers a tab, or it hands the
 * seller a tab that opens onto nothing. That is exactly what happened on a
 * delivered order: Lalamove had no job and a delivered order isn't bookable,
 * so its card returned null while the hub still advertised the tab.
 *
 * So the predicate lives here once, and the cards read it too — two copies
 * would drift on the first new block reason.
 *
 *   "none" — render nothing at all.
 *   "hint" — the one-line discoverability nudge for a provider this seller
 *            has never set up. A nudge is NOT a dispatch surface: the hub
 *            must not build a tab strip around it (a dashed hint inside a
 *            provider switch reads as a broken card), so it stays out of the
 *            tabbed layout and renders inline as it always did.
 *   "card" — the real card: quote, book, track, cancel, or a
 *            disabled-with-reason state that names its own fix.
 */

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { isActiveJobStatus } from "../../convex/lib/deliveryJobs";
import type { DeliveryMethod } from "./orderStatus";

export type DispatchSurface = "none" | "hint" | "card";

/**
 * Does this order put a PARCEL in motion — something to hand a courier, stick
 * a label on, and chase with a consignment number? Only `delivery` does.
 *
 * This is a named predicate rather than an inline comparison because the
 * shipping surfaces used to ask **`!isSelfCollect`** — "not a pickup, so it
 * must be a parcel". That was true while `delivery | self_collect` were the
 * only two methods, and became wrong the day `booking` joined them: a
 * campsite stay was offered a Shipment-tracking card, and told "the buyer's
 * order page shows it the moment you add it", for a parcel that does not
 * exist (reported 8 Sep). Pickup is not the only thing that isn't a parcel —
 * ask what this IS, never what it isn't.
 *
 * `undefined` reads as `delivery`: it is the legacy value from before the
 * field existed, and every caller already resolves it that way. Failing to
 * the parcel side is the safe direction — the cost of being wrong is a
 * tracking card on an order that doesn't need one, not a real parcel with
 * nowhere to put its consignment number.
 */
export function shipsAsParcel(method: DeliveryMethod | undefined): boolean {
	return (method ?? "delivery") === "delivery";
}

type LalamoveDispatch = FunctionReturnType<typeof api.lalamove.getDeliveryJob>;
type DelyvaDispatch = FunctionReturnType<typeof api.delyva.getDispatchState>;

/** Orders a courier or rider can still be booked on. Both providers agree on
 * this window; the servers enforce it (`bad_status`). */
function bookableStatus(order: Doc<"orders">): boolean {
	return order.status === "confirmed" || order.status === "packed";
}

export function lalamoveSurface(
	order: Doc<"orders">,
	dispatch: LalamoveDispatch | undefined,
): DispatchSurface {
	if (!shipsAsParcel(order.deliveryMethod) || !dispatch) return "none";
	const { job, blockReason } = dispatch;
	const activeJob = job && isActiveJobStatus(job.status);
	// No rider works in Singapore and none is out — a completed or failed
	// Malaysian trip belongs on the timeline, not under a live dispatch card
	// that would re-offer a booking (86eyqgujv). Never while one is still out:
	// cancel lives on that card.
	if (blockReason === "country_unsupported" && !activeJob) return "none";
	if (!job && !bookableStatus(order)) return "none";
	if (!job && blockReason === "booking_disabled") return "hint";
	return "card";
}

export function delyvaSurface(
	order: Doc<"orders">,
	dispatch: DelyvaDispatch | undefined,
): DispatchSurface {
	if (!shipsAsParcel(order.deliveryMethod) || !dispatch) return "none";
	const { job, blockReason } = dispatch;
	if (blockReason === "country_unsupported" && !job) return "none";
	if ((blockReason === "not_delivery" || blockReason === "no_address") && !job)
		return "none";
	// A set-up nudge belongs on orders the seller could still act on. On a
	// delivered or cancelled order it is noise — the Lalamove posture, applied
	// here so the two cards behave alike.
	if (!dispatch.bookingEnabled && !job)
		return bookableStatus(order) ? "hint" : "none";
	return "card";
}
