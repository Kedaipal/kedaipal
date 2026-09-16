import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useAction, useMutation } from "convex/react";
import { CalendarClock, Loader2, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
	formatFulfilmentDateTime,
	formatFulfilmentTime,
	hhmmFromMinutes,
	MAX_NOTICE_DAYS,
	mytMidnightFromYmd,
	timeMinutesFromHhmm,
	todayMytMidnight,
	ymdFromEpoch,
} from "../../../convex/lib/fulfilmentDate";
import { isActiveJobStatus } from "../../../convex/lib/lalamove";
import { isPaymentWindowLocked } from "../../../convex/lib/orderClaims";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { cn } from "../../lib/utils";
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
 * server guard. It does the same while a claim link's payment window is live
 * (86eyq0epn): the buyer holds a receipt with a running countdown and may be
 * mid-payment, so the date can't move under them.
 *
 * The time rides along for delivery AND self-collect (z8r3fdff97). A pickup
 * time is optional and can be cleared ("come any time that day"); a delivery
 * keeps one, since dispatch composes the rider's moment from it. A drop-off
 * meet-up stays date-only, exactly as checkout offers it — the point's own
 * schedule note governs the hour, and it is shown here beside the date.
 * Bookings never get the trigger: their dates are the check-in and check-out.
 */
export function RescheduleFulfilmentDialog({
	order,
}: {
	order: Doc<"orders">;
}) {
	const [open, setOpen] = useState(false);
	const [dateValue, setDateValue] = useState("");
	const [timeValue, setTimeValue] = useState("");
	const [saving, setSaving] = useState(false);
	const reschedule = useMutation(api.orders.rescheduleFulfilment);
	const prepareBooking = useAction(api.lalamove.prepareBooking);
	// Live Lalamove price for the moment being picked (Zaki, 19 Aug): the
	// reschedule moves the DISPATCH moment too, and rider prices are
	// slot-sensitive — so a Lalamove-enabled store sees what a rider costs at
	// the new time before committing. The buyer's paid fee is frozen and never
	// re-priced here; this is purely the seller's cost outlook, re-quoted for
	// real at booking. Debounced (each preview is a live quotation call).
	const [feePreview, setFeePreview] = useState<
		| { state: "idle" }
		| { state: "loading" }
		| { state: "ready"; fee: number; buyerPaidFee: number; immediate: boolean }
		| { state: "unavailable" }
	>({ state: "idle" });
	const previewGenRef = useRef(0);

	const method = order.deliveryMethod ?? "delivery";
	const isDelivery = method === "delivery";
	const isSelfCollect = method === "self_collect";
	// Only delivery orders can carry a rider booking — skip the read otherwise.
	const dispatch = useQuery(
		convexQuery(
			api.lalamove.getDeliveryJob,
			isDelivery && open ? { shortId: order.shortId } : "skip",
		),
	).data;
	const hasActiveRiderJob =
		!!dispatch?.job && isActiveJobStatus(dispatch.job.status);
	// Fee preview only where a rider quote is real: Lalamove is the store's
	// delivery method AND this order is bookable right now. Flat/radius/weight
	// stores never see it — their fees aren't time-sensitive.
	const canPreviewFee =
		isDelivery &&
		dispatch?.riderOnlyStore === true &&
		dispatch.blockReason === null &&
		!hasActiveRiderJob;

	// Debounced slot-price fetch, stale-guarded: only the newest request may
	// paint (a slow quote for an abandoned date must land nowhere).
	// biome-ignore lint/correctness/useExhaustiveDependencies: prepareBooking is a stable hook ref; the effect keys off the picked values + gate.
	useEffect(() => {
		// Invalidate any in-flight quote FIRST, before every early return
		// (PR #201 review): whatever this run decides — idle or a fresh fetch —
		// a result quoted for an earlier moment must land nowhere. Bumping only
		// on the fetch path let a 1–3s Lalamove round-trip paint "ready"
		// underneath the freshly-shown validation error.
		const gen = ++previewGenRef.current;
		if (!open || !canPreviewFee) {
			setFeePreview({ state: "idle" });
			return;
		}
		const date = mytMidnightFromYmd(dateValue);
		const minutes = timeMinutesFromHhmm(timeValue);
		if (Number.isNaN(date) || Number.isNaN(minutes)) {
			setFeePreview({ state: "idle" });
			return;
		}
		const moment = date + minutes * 60000;
		// Don't price a moment the dialog itself refuses (past, or beyond the
		// 30-day window) — a quote there would legitimise an invalid pick.
		const today = todayMytMidnight();
		if (
			moment < Date.now() ||
			date < today ||
			date > today + MAX_NOTICE_DAYS * DAY_MS
		) {
			setFeePreview({ state: "idle" });
			return;
		}
		setFeePreview({ state: "loading" });
		const handle = setTimeout(() => {
			prepareBooking({ shortId: order.shortId, scheduleAtOverride: moment })
				.then((res) => {
					if (gen !== previewGenRef.current) return;
					if (!res.ok) {
						setFeePreview({ state: "unavailable" });
						return;
					}
					setFeePreview({
						state: "ready",
						fee: res.fee,
						buyerPaidFee: res.buyerPaidFee,
						immediate: res.scheduledFor === undefined,
					});
				})
				.catch(() => {
					if (gen === previewGenRef.current)
						setFeePreview({ state: "unavailable" });
				});
		}, 500);
		return () => clearTimeout(handle);
	}, [open, canPreviewFee, dateValue, timeValue, order.shortId]);

	const inWindow =
		(order.status === "pending" ||
			order.status === "confirmed" ||
			order.status === "packed") &&
		order.source !== "counter" &&
		method !== "booking" &&
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
	// Drop-off meet-ups are date-only, like checkout offers them.
	const showTime = isDelivery || (isSelfCollect && !dropOff);
	const timeLabel = isDelivery
		? collection
			? "Collection time"
			: "Delivery time"
		: "Pickup time";
	const scheduleNote = dropOff
		? order.pickupSnapshot?.scheduleNote?.trim()
		: undefined;

	const today = todayMytMidnight();
	const minYmd = ymdFromEpoch(today);
	const maxYmd = ymdFromEpoch(today + MAX_NOTICE_DAYS * DAY_MS);

	function openDialog() {
		// Prefill from the order, clamped to today: an overdue order (the very
		// case this dialog exists for) must not open onto a date its own
		// validation rejects. The agreed time-of-day is kept — often only the
		// day moves.
		const prefillDate =
			order.fulfilmentDate !== undefined
				? Math.max(order.fulfilmentDate, todayMytMidnight())
				: undefined;
		setDateValue(prefillDate !== undefined ? ymdFromEpoch(prefillDate) : "");
		setTimeValue(
			order.fulfilmentTimeMinutes !== undefined
				? hhmmFromMinutes(order.fulfilmentTimeMinutes)
				: "",
		);
		setOpen(true);
	}

	// Claim links (86eyq0epn): the receipt is out and a countdown is running
	// against THIS date. Mirrors the server guard in orders.rescheduleFulfilment.
	const paymentWindowLocked = isPaymentWindowLocked(order);

	// Live preview of exactly what the buyer's order page will say — parse
	// failures (mid-typing) just hide the line.
	const previewDate = mytMidnightFromYmd(dateValue);
	const previewTime = timeMinutesFromHhmm(timeValue);
	const previewLabel = Number.isNaN(previewDate)
		? null
		: formatFulfilmentDateTime(
				previewDate,
				showTime && !Number.isNaN(previewTime) ? previewTime : undefined,
			);
	// A self-collect time emptied in the field is a CLEAR, and says what it
	// removes — only when there was one to remove.
	const clearsPickupTime =
		isSelfCollect &&
		showTime &&
		timeValue.trim() === "" &&
		order.fulfilmentTimeMinutes !== undefined;

	// Live validation with a visible reason — the native min/max only grey the
	// picker; typed or stepped values below them still land in state. A past
	// moment as the buyer's promise is always a mistake, so Save is
	// disabled-with-reason instead of failing at the server. Parse failures
	// mid-typing stay quiet (Save is disabled on an empty date anyway).
	const scheduleIssue = (() => {
		if (Number.isNaN(previewDate)) return null;
		const today = todayMytMidnight();
		if (previewDate < today)
			return "That day has already passed — pick today or later.";
		if (previewDate > today + MAX_NOTICE_DAYS * DAY_MS)
			return "The date can be at most 30 days from today.";
		// Emptying a delivery's time used to preview as date-only while the save
		// quietly kept the old time — the preview lied. A delivery keeps a time
		// (dispatch composes the rider's moment from it), so say so instead.
		if (
			isDelivery &&
			timeValue.trim() === "" &&
			order.fulfilmentTimeMinutes !== undefined
		)
			return "A delivery keeps a time — pick a new one rather than clearing it.";
		if (
			showTime &&
			!Number.isNaN(previewTime) &&
			previewDate + previewTime * 60000 < Date.now()
		)
			return "That time has already passed today — pick a later time.";
		return null;
	})();

	async function handleSave() {
		const date = mytMidnightFromYmd(dateValue);
		if (Number.isNaN(date)) {
			toast.error("Pick a valid date first.");
			return;
		}
		if (scheduleIssue) return; // Save is disabled; belt-and-braces.
		// number = set, null = clear (self-collect only), undefined = keep.
		let timeMinutes: number | null | undefined;
		if (showTime && timeValue.trim() !== "") {
			timeMinutes = timeMinutesFromHhmm(timeValue);
			if (Number.isNaN(timeMinutes)) {
				toast.error("Pick a valid time first.");
				return;
			}
		} else if (clearsPickupTime) {
			timeMinutes = null;
		}
		// Fresh-clock re-check (PR #201 review): scheduleIssue was computed at
		// render time — a dialog left open while the picked moment passed would
		// otherwise fire the mutation, and the server's time-of-day check is
		// deliberately range-only. Past DAYS are server-rejected regardless;
		// only passed-time-today slips, so that's what gets re-judged here.
		if (
			typeof timeMinutes === "number" &&
			date + timeMinutes * 60000 < Date.now()
		) {
			toast.error("That time has just passed — pick a later time.");
			return;
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
					timeMinutes === null
						? undefined
						: (timeMinutes ?? order.fulfilmentTimeMinutes),
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
			{/* The locked state stays TAPPABLE rather than going disabled: a
			    `title` tooltip is invisible on the phone this dashboard is built
			    for, so the reason has to be reachable. The chrome (lock glyph,
			    muted tone) says "closed" at a glance; the tap says why. */}
			<Button
				type="button"
				variant="outline"
				className={cn(
					"h-11 shrink-0 px-3 text-xs",
					paymentWindowLocked && "text-muted-foreground",
				)}
				onClick={openDialog}
			>
				{paymentWindowLocked ? (
					<Lock className="size-4" />
				) : (
					<CalendarClock className="size-4" />
				)}
				{paymentWindowLocked
					? "Locked"
					: order.fulfilmentDate !== undefined
						? "Reschedule"
						: "Set date"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{paymentWindowLocked
								? "Locked while they pay"
								: order.fulfilmentDate !== undefined
									? "Reschedule this order"
									: "Set a fulfilment date"}
						</DialogTitle>
						<DialogDescription>
							{paymentWindowLocked
								? "This date is part of what the buyer is paying for."
								: isDelivery
									? collection
										? "Change when the rider collects from your customer."
										: "Change when this order should be delivered."
									: dropOff
										? "Change when you meet the buyer at the drop-off point."
										: "Change when the buyer picks this order up."}
						</DialogDescription>
					</DialogHeader>
					{paymentWindowLocked ? (
						<div className="flex flex-col gap-3">
							<p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
								This buyer is paying against this date right now — their order
								page is counting down to a deadline. Moving it mid-payment would
								change the deal under them, so it&apos;s locked until the
								payment lands. If the date really has to move, cancel the order
								(that restocks it and releases the buyer) and send a fresh link.
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
					) : hasActiveRiderJob ? (
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
							<div className={showTime ? "grid grid-cols-2 gap-2" : ""}>
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
								{showTime ? (
									<label className="flex flex-col gap-1.5 text-sm font-medium">
										{timeLabel}
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
							{/* A pickup time is optional — say so where the seller is
							    clicking, and make clearing a visible action rather than
							    a native-picker trick most sellers never find. */}
							{isSelfCollect && showTime ? (
								<div className="flex min-h-11 items-center justify-between gap-2">
									<p className="text-xs text-muted-foreground">
										{clearsPickupTime && order.fulfilmentTimeMinutes !== undefined
											? `Removes the ${formatFulfilmentTime(order.fulfilmentTimeMinutes)} pickup time — the buyer can come any time that day.`
											: "Optional — leave blank for any time that day."}
									</p>
									{timeValue.trim() !== "" ? (
										<Button
											type="button"
											variant="ghost"
											className="h-11 shrink-0 px-3 text-xs"
											onClick={() => setTimeValue("")}
										>
											Clear time
										</Button>
									) : null}
								</div>
							) : null}
							{scheduleNote ? (
								<p className="text-xs text-muted-foreground">
									Drop-off schedule:{" "}
									<span className="font-medium text-foreground">
										{scheduleNote}
									</span>
								</p>
							) : null}
							{scheduleIssue ? (
								<p className="text-xs font-medium text-destructive">
									{scheduleIssue}
								</p>
							) : null}
							{previewLabel && !scheduleIssue ? (
								<p className="text-sm text-muted-foreground">
									The buyer&apos;s order page will show{" "}
									<span className="font-medium text-foreground">
										{previewLabel}
									</span>
									.
								</p>
							) : null}
							{/* Rider-cost outlook for the picked slot (Lalamove stores on a
							    bookable order only) — the buyer's paid fee never moves here. */}
							{canPreviewFee && feePreview.state !== "idle" ? (
								<div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
									<div className="flex items-center justify-between gap-2 text-sm">
										<span className="text-muted-foreground">
											Lalamove for this slot
										</span>
										{feePreview.state === "loading" ? (
											<Loader2 className="size-4 animate-spin text-muted-foreground" />
										) : feePreview.state === "ready" ? (
											<span className="font-semibold tabular-nums">
												{formatPrice(feePreview.fee, order.currency)}
											</span>
										) : (
											<span className="text-xs text-muted-foreground">
												No price right now
											</span>
										)}
									</div>
									{feePreview.state === "ready" &&
									feePreview.fee !== feePreview.buyerPaidFee ? (
										<p className="text-xs text-muted-foreground">
											Buyer paid{" "}
											{formatPrice(feePreview.buyerPaidFee, order.currency)} —
											the difference settles from your Lalamove wallet when you
											book.
										</p>
									) : null}
									{feePreview.state === "ready" && feePreview.immediate ? (
										<p className="text-xs text-muted-foreground">
											This time is close — booking would send the rider straight
											away.
										</p>
									) : null}
									{feePreview.state === "ready" ? (
										<p className="text-xs text-muted-foreground/80">
											Estimate for today — re-quoted when you book.
										</p>
									) : null}
								</div>
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
									disabled={
										saving || dateValue === "" || scheduleIssue !== null
									}
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
