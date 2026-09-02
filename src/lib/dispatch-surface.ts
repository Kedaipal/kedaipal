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

export type DispatchSurface = "none" | "hint" | "card";

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
	if (order.deliveryMethod !== "delivery" || !dispatch) return "none";
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
	if (order.deliveryMethod !== "delivery" || !dispatch) return "none";
	const { job, blockReason } = dispatch;
	if (blockReason === "country_unsupported" && !job) return "none";
	if ((blockReason === "not_delivery" || blockReason === "no_address") && !job)
		return "none";
	if (!dispatch.bookingEnabled && !job) return "hint";
	return "card";
}
