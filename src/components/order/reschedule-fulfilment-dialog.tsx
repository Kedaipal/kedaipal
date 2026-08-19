import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	MAX_NOTICE_DAYS,
	formatFulfilmentDateTime,
	hhmmFromMinutes,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import { isActiveJobStatus } from "../../../convex/lib/lalamove";
import { convexErrorMessage } from "../../lib/format";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seller-side reschedule of an order's fulfilment date/time (86eyp5qd1) — the
 * escape hatch for the 3 AM advance order: the buyer picked the moment at
 * checkout, the seller agrees a new one in chat and records it here. The
 * buyer's tracking page reads the order live, so it shows the new moment
 * instantly; deliberately NO WhatsApp send (one-msg-per-order posture).
 *
 * Renders its own trigger, only inside the reschedule window (pre-shipped,
 * not counter, not already collected) — outside it the moment is history and
 * a dead disabled button would be noise. While a Lalamove booking is ACTIVE
 * the dialog opens onto an explanation instead of the form (the booking is
 * frozen against its quotationId and won't follow the order), mirroring the
 * server guard.
 */
export function RescheduleFulfilmentDialog({ order }: { order: Doc<"orders"> }) {
	const [open, setOpen] = useState(false);
	const [dateValue, setDateValue] = useState("");
	const [timeValue, setTimeValue] = useState("");
	const [saving, setSaving] = useState(false);
	const reschedule = useMutation(api.orders.rescheduleFulfilment);

	const isDelivery = order.deliveryMethod !== "self_collect";
	// Only delivery orders can carry a rider booking — skip the read otherwise.
	const dispatch = useQuery(
		convexQuery(
			api.lalamove.getDeliveryJob,
			isDelivery && open ? { shortId: order.shortId } : "skip",
		),
	).data;
	const hasActiveRiderJob =
		!!dispatch?.job && isActiveJobStatus(dispatch.job.status);

	const inWindow =
		(order.status === "pending" ||
			order.status === "confirmed" ||
			order.status === "packed") &&
		order.source !== "counter" &&
		order.collectedAt === undefined;
	if (!inWindow) return null;

	const collection = order.deliveryDirection === "collection";
	const dropOff = order.pickupSnapshot?.locationType === "drop_off";
	const dateLabel = isDelivery
		? collection
			? "Collection date"
			: "Delivery date"
		: dropOff
			? "Meet-up date"
			: "Pickup date";

	const today = todayMytMidnight();
	const minYmd = ymdFromEpoch(today);
	const maxYmd = ymdFromEpoch(today + MAX_NOTICE_DAYS * DAY_MS);

	function openDialog() {
		setDateValue(
			order.fulfilmentDate !== undefined ? ymdFromEpoch(order.fulfilmentDate) : "",
		);
		setTimeValue(
			order.fulfilmentTimeMinutes !== undefined
				? hhmmFromMinutes(order.fulfilmentTimeMinutes)
				: "",
		);
		setOpen(true);
	}

	// Live preview of exactly what the buyer's order page will say — parse
	// failures (mid-typing) just hide the line.
	const previewDate = mytMidnightFromYmd(dateValue);
	const previewTime = timeMinutesFromHhmm(timeValue);
	const previewLabel = Number.isNaN(previewDate)
		? null
		: formatFulfilmentDateTime(
				previewDate,
				isDelivery && !Number.isNaN(previewTime) ? previewTime : undefined,
			);

	async function handleSave() {
		const date = mytMidnightFromYmd(dateValue);
		if (Number.isNaN(date)) {
			toast.error("Pick a valid date first.");
			return;
		}
		let timeMinutes: number | undefined;
		if (isDelivery && timeValue.trim() !== "") {
			timeMinutes = timeMinutesFromHhmm(timeValue);
			if (Number.isNaN(timeMinutes)) {
				toast.error("Pick a valid time first.");
				return;
			}
		}
		setSaving(true);
		try {
			await reschedule({
				orderId: order._id,
				fulfilmentDate: date,
				fulfilmentTimeMinutes: timeMinutes,
			});
			toast.success(
				`Updated — the buyer's order page now shows ${formatFulfilmentDateTime(
					date,
					timeMinutes ?? (isDelivery ? order.fulfilmentTimeMinutes : undefined),
				)}.`,
			);
			setOpen(false);
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="h-11 shrink-0 px-3 text-xs"
				onClick={openDialog}
			>
				<CalendarClock className="size-4" />
				{order.fulfilmentDate !== undefined ? "Reschedule" : "Set date"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{order.fulfilmentDate !== undefined
								? "Reschedule this order"
								: "Set a fulfilment date"}
						</DialogTitle>
						<DialogDescription>
							{isDelivery
								? collection
									? "Change when the rider collects from your customer."
									: "Change when this order should be delivered."
								: "Change when the buyer picks this order up."}
						</DialogDescription>
					</DialogHeader>
					{hasActiveRiderJob ? (
						<div className="flex flex-col gap-3">
							<p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
								A Lalamove booking is active for this order. The booking is
								locked to its own pickup time and won&apos;t follow the order —
								cancel it on the Lalamove card first, then reschedule and book
								again at the new time.
							</p>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setOpen(false)}
								>
									Close
								</Button>
							</DialogFooter>
						</div>
					) : (
						<div className="flex flex-col gap-3">
							<div className={isDelivery ? "grid grid-cols-2 gap-2" : ""}>
								<label className="flex flex-col gap-1.5 text-sm font-medium">
									{dateLabel}
									<Input
										type="date"
										variant="field"
										min={minYmd}
										max={maxYmd}
										value={dateValue}
										onChange={(e) => setDateValue(e.target.value)}
									/>
								</label>
								{isDelivery ? (
									<label className="flex flex-col gap-1.5 text-sm font-medium">
										{collection ? "Collection time" : "Delivery time"}
										<Input
											type="time"
											variant="field"
											step={300}
											value={timeValue}
											onChange={(e) => setTimeValue(e.target.value)}
										/>
									</label>
								) : null}
							</div>
							{previewLabel ? (
								<p className="text-sm text-muted-foreground">
									The buyer&apos;s order page will show{" "}
									<span className="font-medium text-foreground">
										{previewLabel}
									</span>
									.
								</p>
							) : null}
							<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
								Updates the buyer&apos;s order page instantly — no WhatsApp
								message is sent, so agree the new time with them in chat first.
							</p>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setOpen(false)}
									disabled={saving}
								>
									Cancel
								</Button>
								<Button
									type="button"
									onClick={handleSave}
									isLoading={saving}
									disabled={saving || dateValue === ""}
								>
									Save new date
								</Button>
							</DialogFooter>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
