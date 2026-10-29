/**
 * EasyParcel courier dispatch card — order detail (z8r3fdcje2, Open API).
 *
 * The Delyva card's sibling for Singapore parcels, differing where EasyParcel
 * differs:
 *  - Rates come back as a LIST with indicative prices (no quotation to hold,
 *    no countdown), so the picker is INLINE like Delyva's.
 *  - The API requires the parcel's DIMENSIONS and couriers price on volume,
 *    so the box is picked here, stated in cm, and it re-prices like weight.
 *  - EasyParcel is PREPAID and books AND charges in one call: the wallet sits
 *    beside the rates, and a pick it can't cover is disabled with the reason
 *    before the tap.
 *  - The booking hands back the courier's own label PDF, linked on the card.
 *  - A quote runs to 20+ services, so the list opens on the cheap end with
 *    "Show all", splits door delivery from point collection when a quote
 *    holds both, and pre-selects the cheapest service that KEEPS the order's
 *    promise — to the buyer's door, one parcel, by their date
 *    (`src/lib/easyparcel-rates.ts`). Each fact a service's name hides is a
 *    chip, so a phone never truncates the part that matters.
 *  - Status arrives by webhook (and an hourly backstop); "Refresh status"
 *    re-reads it now.
 *  - Cancelling is real: EasyParcel cancels and refunds the wallet, and its
 *    own refusal (the 7-days-from-collection window) is shown as it says it.
 *
 * An empty rate list is a normal answer, not an error — it hands off to the
 * manual-courier flow instead of a dead end.
 */

import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAction } from "convex/react";
import {
	CircleAlert,
	ExternalLink,
	FileText,
	FlaskConical,
	Package,
	RefreshCw,
	Truck,
	Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { isActiveJobStatus } from "../../../convex/lib/deliveryJobs";
import {
	describeEasyparcelService,
	type EasyparcelRate,
	PARCEL_BOXES,
	type ParcelBox,
	transitLabel,
} from "../../../convex/lib/easyparcel";
import { formatFulfilmentDate } from "../../../convex/lib/fulfilmentDate";
import { courierContactFallbackCopy } from "../../lib/delyva-dispatch-block";
import { easyparcelSurface } from "../../lib/dispatch-surface";
import {
	easyparcelBlockCopy,
	easyparcelStatusLabel,
} from "../../lib/easyparcel-dispatch-block";
import {
	defaultRateId,
	filterRates,
	RATES_SHOWN_FIRST,
	type RateFilter,
	rateDateFit,
	rateFilterCounts,
} from "../../lib/easyparcel-rates";
import { convexErrorMessage, formatPrice } from "../../lib/format";
import { TONE_ACCENT, TONE_CHIP, TONE_PANEL } from "../../lib/tone";
import { ProBadge } from "../app/pro-gate";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CopyButton } from "../ui/copy-button";
import { FilterChip } from "../ui/filter-chip";
import { Input } from "../ui/input";

const BOXES: ReadonlyArray<{ value: ParcelBox; label: string }> = [
	{ value: "small", label: "Small" },
	{ value: "medium", label: "Medium" },
	{ value: "large", label: "Large" },
];

function boxSize(box: ParcelBox): string {
	const d = PARCEL_BOXES[box];
	return `${d.lengthCm}×${d.widthCm}×${d.heightCm} cm`;
}

export function EasyparcelDispatchCard({
	order,
	embedded = false,
	lockedReason,
}: {
	order: Doc<"orders">;
	/** Rendered inside the dispatch hub's shell — see BookDeliveryCard. */
	embedded?: boolean;
	/** Set while the store can't book right now (out of credits, or
	 * view-only) — see BookDeliveryCard. Cancelling stays open. */
	lockedReason?: string;
}) {
	const dispatch = useQuery(
		convexQuery(api.easyparcel.getDispatchState, { shortId: order.shortId }),
	).data;

	const prepareBooking = useAction(api.easyparcel.prepareBooking);
	const confirmBooking = useAction(api.easyparcel.confirmBooking);
	const cancelBooking = useAction(api.easyparcel.cancelBooking);
	const refreshJobStatus = useAction(api.easyparcel.refreshJobStatus);

	const [weightInput, setWeightInput] = useState("");
	const [box, setBox] = useState<ParcelBox>("small");
	const [rates, setRates] = useState<EasyparcelRate[] | null>(null);
	/** The wallet read that came back WITH the rates — the verdict and the
	 * prices are from one moment. */
	const [quotedBalance, setQuotedBalance] = useState<number | undefined>();
	const [quotedCurrency, setQuotedCurrency] = useState<string | undefined>();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [filter, setFilter] = useState<RateFilter>("door");
	const [showAll, setShowAll] = useState(false);
	const [quoting, setQuoting] = useState(false);
	const [booking, setBooking] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingCancel, setConfirmingCancel] = useState(false);

	// Seed the weight once from the order's product weights (the Delyva ref
	// posture — clearing the field must not snap the value back).
	const seededWeight = useRef(false);
	useEffect(() => {
		if (seededWeight.current) return;
		if (dispatch?.computedWeightKg != null) {
			seededWeight.current = true;
			setWeightInput(String(dispatch.computedWeightKg));
		}
	}, [dispatch?.computedWeightKg]);

	// One source for "does this provider have anything to show here" — the
	// dispatch hub asks the same question before it offers a tab.
	const surface = easyparcelSurface(order, dispatch);
	if (surface === "none" || !dispatch) return null;

	const job = dispatch.job;
	const activeJob = job && isActiveJobStatus(job.status) ? job : null;
	const failedJob =
		job &&
		(job.status === "canceled" ||
			job.status === "expired" ||
			job.status === "rejected")
			? job
			: null;
	const completedJob = job?.status === "completed" ? job : null;
	const blockReason = dispatch.blockReason;
	const bookable = blockReason === null;
	const errorPanel = (
		<p
			role="alert"
			className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm border ${TONE_PANEL.warn}`}
		>
			<CircleAlert className="mt-0.5 size-4 shrink-0" />
			<span>{error}</span>
		</p>
	);
	const walletCurrency =
		quotedCurrency ?? dispatch.balanceCurrency ?? order.currency;
	const bookedService = job?.serviceName
		? describeEasyparcelService(job.serviceName)
		: undefined;

	if (surface === "hint") {
		if (blockReason === "disabled") {
			return (
				<p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
					<Truck className="mr-1.5 inline size-3.5 align-[-2px]" />
					EasyParcel booking is paused — turn <b>EasyParcel couriers</b> back on
					under Courier booking in{" "}
					<Link
						to="/app/settings/delivery-pricing"
						hash="courier-booking"
						className="font-medium text-accent hover:underline"
					>
						Settings → Delivery pricing
					</Link>
					.
				</p>
			);
		}
		if (blockReason === "plan_gated") {
			return (
				<p className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
					<Truck className="size-3.5" />
					Book Singapore parcel couriers straight from an order.
					<ProBadge />
				</p>
			);
		}
		return (
			<p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
				<Truck className="mr-1.5 inline size-3.5 align-[-2px]" />
				Ship parcels without leaving Kedaipal —{" "}
				<Link
					to="/app/settings"
					search={{ tab: "integrations" }}
					className="font-medium text-accent hover:underline"
				>
					connect EasyParcel
				</Link>{" "}
				to book couriers and have tracking numbers and labels fill themselves
				in.
			</p>
		);
	}

	const weightKg = Number(weightInput);
	const weightValid = Number.isFinite(weightKg) && weightKg > 0;
	const needsTypedWeight = dispatch.computedWeightKg === null;

	async function handleQuote() {
		setQuoting(true);
		setError(null);
		try {
			const result = await prepareBooking({
				shortId: order.shortId,
				box,
				weightKgOverride: weightValid ? weightKg : undefined,
			});
			if (!result.ok) {
				setError(result.message ?? easyparcelBlockCopy(result.reason));
				setRates(null);
				return;
			}
			setRates(result.rates);
			setQuotedBalance(result.balanceMinor);
			setQuotedCurrency(result.balanceCurrency);
			// The cheapest that keeps the order's promise — never just the
			// cheapest, which can leave a delivery at a locker.
			const pick = defaultRateId(result.rates, order.fulfilmentDate);
			setSelectedId(pick);
			setFilter(
				result.rates.find((r) => r.serviceId === pick)?.deliversTo === "point"
					? "point"
					: "door",
			);
			setShowAll(false);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setQuoting(false);
		}
	}

	async function handleBook() {
		const rate = rates?.find((r) => r.serviceId === selectedId);
		if (!rate) return;
		setBooking(true);
		setError(null);
		try {
			const result = await confirmBooking({
				shortId: order.shortId,
				serviceId: rate.serviceId,
				serviceName: rate.serviceName,
				courierName: rate.courierName,
				priceMinor: rate.priceMinor,
				box,
				weightKgOverride: weightValid ? weightKg : undefined,
			});
			if (!result.ok) {
				// In place, not a toast: the seller may come back from a top-up,
				// and the reason must still be on screen (the 86eypncfy lesson).
				setError(result.message ?? easyparcelBlockCopy(result.reason));
				return;
			}
			setRates(null);
			setSelectedId(null);
			toast.success(`${rate.label} booked`);
		} catch (err) {
			setError(convexErrorMessage(err));
		} finally {
			setBooking(false);
		}
	}

	async function handleRefreshStatus() {
		setRefreshing(true);
		try {
			const result = await refreshJobStatus({ shortId: order.shortId });
			if (!result.ok)
				toast.error(result.message ?? "Couldn't refresh the status");
		} catch (err) {
			toast.error(convexErrorMessage(err));
		} finally {
			setRefreshing(false);
		}
	}

	const selected = rates?.find((r) => r.serviceId === selectedId) ?? null;
	const selectedUnaffordable =
		selected !== null &&
		quotedBalance !== undefined &&
		selected.priceMinor > quotedBalance;
	const counts = rates ? rateFilterCounts(rates) : { door: 0, point: 0 };
	const bothModes = counts.door > 0 && counts.point > 0;
	const filtered = rates
		? bothModes
			? filterRates(rates, filter)
			: rates
		: [];
	// The cheap end first; the pick always stays on screen even when it sits
	// past the fold, so "Book X" never names a row the seller can't see.
	const visibleRates = showAll
		? filtered
		: [
				...filtered.slice(0, RATES_SHOWN_FIRST),
				...filtered
					.slice(RATES_SHOWN_FIRST)
					.filter((r) => r.serviceId === selectedId),
			];
	const hiddenCount = filtered.length - visibleRates.length;
	const buyerDate =
		order.fulfilmentDate !== undefined
			? formatFulfilmentDate(order.fulfilmentDate, { year: false })
			: null;

	return (
		<section
			className={
				embedded
					? "flex flex-col gap-3"
					: "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
			}
		>
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
					EasyParcel Courier
				</p>
				{job && !failedJob ? (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
							completedJob
								? TONE_CHIP.success
								: "bg-accent/15 text-accent-emphasis"
						}`}
					>
						{easyparcelStatusLabel(job.status)}
					</span>
				) : null}
			</div>

			{/* A sandbox booking dispatches no courier and spends play money,
			    and looks identical to a real one until nobody turns up — so it
			    is said at the point of spend (86eypncfy). */}
			{dispatch.environment === "sandbox" ? (
				<p
					className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm border ${TONE_PANEL.warn}`}
				>
					<FlaskConical className="mt-0.5 size-4 shrink-0" />
					<span>
						<span className="font-medium">
							Test mode — no courier will come.
						</span>{" "}
						Kedaipal is connected to an EasyParcel demo account, so bookings
						here are simulated. Reconnect with your live account in{" "}
						<Link
							to="/app/settings"
							search={{ tab: "integrations" }}
							className="font-medium underline underline-offset-2"
						>
							Settings → Integrations
						</Link>
						.
					</span>
				</p>
			) : null}

			{/* The same refusal is already beside Book while it's fresh. */}
			{failedJob && !activeJob && !error ? (
				<p
					className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm border ${TONE_PANEL.warn}`}
				>
					<CircleAlert className="mt-0.5 size-4 shrink-0" />
					<span>
						<span className="font-medium">
							{/* "Cancelled" only for a shipment that existed: a refused
							    submit never got a shipment number. */}
							{failedJob.status === "canceled" &&
							failedJob.shipmentNumber !== undefined
								? "Booking cancelled"
								: "Booking didn't go through"}
						</span>
						{failedJob.failureReason
							? ` — ${failedJob.failureReason.trim().replace(/[.!]+$/, "")}`
							: ""}
						. Your buyer was not notified; the order is unchanged.
					</span>
				</p>
			) : null}

			{job && (activeJob || completedJob) ? (
				<div className="flex flex-col gap-2.5 text-sm">
					{/* The stored name, read for what it promises — the label the
					    picker showed, and whether the seller must drop it off. */}
					<div className="flex items-center gap-2">
						<Truck className="size-4 shrink-0 text-accent" />
						<span className="font-medium">
							{bookedService?.label ?? "EasyParcel"}
						</span>
						{job.shipmentNumber ? (
							<span className="ml-auto font-mono text-xs text-muted-foreground">
								{job.shipmentNumber}
							</span>
						) : null}
					</div>

					{job.awb ? (
						<div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="text-xs text-muted-foreground">
									Tracking number
								</span>
								<span className="truncate font-mono text-sm font-semibold">
									{job.awb}
								</span>
							</span>
							<CopyButton value={job.awb} ariaLabel="Copy tracking number" />
						</div>
					) : (
						<p className="text-muted-foreground">
							Booked — waiting for {bookedService?.label ?? "the courier"} to
							issue a tracking number. It appears here and on your buyer&apos;s
							order page by itself.
						</p>
					)}

					{/* The courier's own label — beside Kedaipal's despatch label,
					    never instead of it. */}
					{job.labelUrl ? (
						<a
							href={job.labelUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium text-accent-emphasis hover:border-accent/40"
						>
							<FileText className="size-4 shrink-0" />
							Courier label (PDF)
							<ExternalLink className="ml-auto size-3.5 shrink-0" />
						</a>
					) : null}

					{/* Drop-off is the one service the seller still has a job on —
					    say it while it's owed (test-code F21). */}
					{activeJob &&
					activeJob.status === "assigning" &&
					bookedService?.sellerHandoff === "dropoff" ? (
						<p
							className={`rounded-xl border px-3 py-2.5 text-sm ${TONE_PANEL.info}`}
						>
							<b>Next: drop the parcel off.</b> Print the courier label above,
							stick it on, and hand the parcel in at any{" "}
							{order.courierName ?? "courier"} drop-off point. Nothing is
							collected from you for this service.
						</p>
					) : null}

					<p className="text-muted-foreground">
						{completedJob
							? "Delivered — your buyer's order page shows it."
							: bookedService?.sellerHandoff === "dropoff"
								? "Your buyer can see the tracking number on their order page. The order marks itself Shipped once the courier scans the parcel in, and Delivered on arrival."
								: "Your buyer can see the tracking number on their order page. The order marks itself Shipped at collection and Delivered on arrival."}
					</p>

					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>
							Paid {formatPrice(job.costActual, walletCurrency)} from your
							EasyParcel wallet
						</span>
						{order.carrierTrackingUrl ? (
							<a
								href={order.carrierTrackingUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-center gap-1 font-medium text-accent hover:underline"
							>
								Track parcel <ExternalLink className="size-3" />
							</a>
						) : null}
					</div>

					{activeJob ? (
						<div className="flex flex-col gap-1">
							<Button
								type="button"
								variant="outline"
								className="h-11 w-full"
								isLoading={refreshing}
								onClick={() => void handleRefreshStatus()}
							>
								<RefreshCw className="size-4" /> Refresh status
							</Button>
							<Button
								type="button"
								variant="ghost"
								className="h-11 w-full text-destructive"
								onClick={() => setConfirmingCancel(true)}
							>
								Cancel booking
							</Button>
						</div>
					) : null}
				</div>
			) : bookable && !lockedReason ? (
				<>
					{dispatch.pickupSummary ? (
						<p className="text-xs text-muted-foreground">
							Collecting from{" "}
							<span className="font-medium text-foreground">
								{dispatch.pickupSummary}
							</span>{" "}
							·{" "}
							<Link
								to="/app/settings"
								search={{ tab: "integrations" }}
								className="-my-2 py-2 font-medium text-accent hover:underline"
							>
								Edit
							</Link>
						</p>
					) : null}

					{dispatch.buyerContactFallback ? (
						<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
							{courierContactFallbackCopy(dispatch.receiverCountry)}
						</p>
					) : null}

					{/* Weight and box are the two numbers that set the price, so
					    both are editable here and both drop stale prices. */}
					<div className="flex flex-col gap-1.5">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-medium text-muted-foreground">
								Parcel weight
							</span>
							{!needsTypedWeight ? (
								<span className="text-[11px] text-muted-foreground">
									From your product weights
								</span>
							) : null}
						</div>
						<div className="flex items-center gap-2">
							<Input
								variant="field"
								type="text"
								inputMode="decimal"
								aria-label="Parcel weight in kilograms"
								value={weightInput}
								disabled={quoting || booking}
								isError={weightInput !== "" && !weightValid}
								onChange={(e) => {
									setWeightInput(e.target.value.replace(/[^\d.]/g, ""));
									setRates(null);
									setError(null);
								}}
								className="max-w-28"
							/>
							<span className="text-sm text-muted-foreground">kg</span>
						</div>
						{needsTypedWeight ? (
							<p className="text-xs text-muted-foreground">
								{dispatch.weightIssue === "custom_item"
									? "This order has a custom line, so we can't work its weight out — weigh the packed parcel and type it here."
									: "Some items here have no parcel weight set, so we can't add it up — weigh the packed parcel and type it here (or set weights in Products)."}
							</p>
						) : null}
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							Box size
						</span>
						<div className="grid grid-cols-3 gap-2">
							{BOXES.map((b) => {
								const active = box === b.value;
								return (
									<button
										key={b.value}
										type="button"
										aria-pressed={active}
										disabled={quoting || booking}
										onClick={() => {
											setBox(b.value);
											setRates(null);
											setError(null);
										}}
										className={`flex min-h-11 flex-col items-center justify-center rounded-xl border-2 px-2 py-1.5 text-xs transition-colors disabled:opacity-60 ${
											active
												? "border-accent bg-accent/[0.08] font-semibold text-accent-emphasis"
												: "border-border bg-card text-muted-foreground hover:border-accent/40"
										}`}
									>
										<span className="flex items-center gap-1">
											<Package className="size-3" />
											{b.label}
										</span>
										<span className="text-[10px] font-normal">
											{boxSize(b.value)}
										</span>
									</button>
								);
							})}
						</div>
						<p className="text-xs text-muted-foreground">
							Couriers charge on size as well as weight — pick the box you pack
							in, or the next size up.
						</p>
					</div>

					{/* Before prices exist the button sits right under this; once
					    they do, a refusal renders beside Book instead (below). */}
					{error && !(rates && rates.length > 0) ? errorPanel : null}

					{rates === null ? (
						<Button
							type="button"
							className="h-11 w-full"
							isLoading={quoting}
							disabled={quoting || !weightValid}
							onClick={() => void handleQuote()}
						>
							{quoting ? (
								"Getting courier prices…"
							) : (
								<>
									<Truck className="size-4" />
									{failedJob
										? failedJob.status === "canceled" &&
											failedJob.shipmentNumber !== undefined
											? "Book again"
											: "Try again"
										: "Get courier prices"}
								</>
							)}
						</Button>
					) : rates.length === 0 ? (
						<div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border px-3 py-3.5">
							<p className="text-sm text-muted-foreground">
								<span className="font-medium text-foreground">
									No courier takes a parcel this size and weight to this address
									right now.
								</span>{" "}
								Check the buyer&apos;s postal code and your pickup address —
								EasyParcel prices on those.
							</p>
							<p className="text-sm text-muted-foreground">
								Arrange delivery yourself and add the tracking number below —
								your buyer still gets the shipped update.
							</p>
							<button
								type="button"
								className="min-h-9 text-xs font-medium text-accent underline-offset-2 hover:underline"
								onClick={() => setRates(null)}
							>
								Start over
							</button>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<div className="flex items-baseline justify-between gap-2">
								<span className="text-xs font-medium text-muted-foreground">
									Choose a courier
								</span>
								<span className="text-[11px] text-muted-foreground">
									Buyer paid{" "}
									{formatPrice(order.deliveryFee ?? 0, order.currency)}
								</span>
							</div>
							{bothModes ? (
								// The house segment chip (one idea, one control) — not a
								// look-alike radio row.
								<fieldset className="flex flex-wrap gap-1.5">
									<legend className="sr-only">
										Where the buyer gets the parcel
									</legend>
									{(
										[
											["door", "To the buyer's door", counts.door],
											["point", "Buyer collects", counts.point],
										] as const
									).map(([value, label, count]) => (
										<FilterChip
											key={value}
											selected={filter === value}
											count={count}
											className="h-11"
											onClick={() => {
												setFilter(value);
												setShowAll(false);
												// Keep the pick if it's in this group; else take
												// this group's own best.
												const group = filterRates(rates, value);
												if (!group.some((r) => r.serviceId === selectedId))
													setSelectedId(
														defaultRateId(group, order.fulfilmentDate),
													);
											}}
										>
											{label}
										</FilterChip>
									))}
								</fieldset>
							) : null}
							{filter === "point" && bothModes ? (
								<p className="text-xs text-muted-foreground">
									These leave the parcel at a locker or shop for the buyer to
									collect — they chose delivery, so tell them before you book
									one.
								</p>
							) : null}
							{visibleRates.map((rate, index) => {
								const active = rate.serviceId === selectedId;
								const fit = rateDateFit(rate, order.fulfilmentDate);
								return (
									<button
										key={rate.serviceId}
										type="button"
										aria-pressed={active}
										disabled={booking}
										onClick={() => setSelectedId(rate.serviceId)}
										// Two lines, not three columns: on a phone the middle
										// column was ~80px and the chips — the facts F9–F13
										// exist to show — folded into blobs (test-code F27).
										className={`flex w-full flex-col gap-1.5 rounded-2xl border-2 p-2.5 text-left transition-colors disabled:opacity-60 ${
											active
												? "border-accent bg-accent/5"
												: "border-border bg-card hover:border-accent/40"
										}`}
									>
										<span className="flex w-full items-start gap-2.5">
											{/* Decoration — it yields its width to the name on the
											    narrowest phones. */}
											<span className="hidden size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground min-[400px]:flex">
												{initials(rate.courierName)}
											</span>
											<span className="flex min-w-0 grow flex-col gap-0.5">
												<span className="text-sm font-semibold leading-snug">
													{rate.label}
												</span>
												<span className="text-xs text-muted-foreground">
													{rateMeta(rate)}
												</span>
											</span>
											<span className="flex shrink-0 flex-col items-end gap-1">
												<span className="text-sm font-bold">
													{formatPrice(
														rate.priceMinor,
														rate.currency || walletCurrency,
													)}
												</span>
												{index === 0 && filtered.length > 1 ? (
													<span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent-emphasis">
														Cheapest
													</span>
												) : null}
											</span>
											<span
												aria-hidden="true"
												className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
													active ? "border-accent" : "border-border"
												}`}
											>
												{active ? (
													<span className="size-2 rounded-full bg-accent" />
												) : null}
											</span>
										</span>
										{rate.deliversTo === "point" ||
										rate.minParcels !== undefined ||
										(fit && buyerDate) ? (
											<span className="flex flex-wrap gap-1 min-[400px]:pl-[2.875rem]">
												{rate.deliversTo === "point" ? (
													<span
														className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CHIP.warn}`}
													>
														Buyer collects at a point
													</span>
												) : null}
												{rate.minParcels !== undefined ? (
													<span
														className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CHIP.warn}`}
													>
														Pickup needs {rate.minParcels}+ parcels
													</span>
												) : null}
												{fit && buyerDate ? (
													<span
														className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
															fit === "late" ? TONE_CHIP.danger : TONE_CHIP.warn
														}`}
													>
														{fit === "late"
															? `Arrives after ${buyerDate}`
															: `May miss ${buyerDate}`}
													</span>
												) : null}
											</span>
										) : null}
									</button>
								);
							})}

							{hiddenCount > 0 ? (
								<button
									type="button"
									onClick={() => setShowAll(true)}
									className="min-h-11 rounded-xl border border-dashed border-border text-xs font-medium text-accent-emphasis hover:border-accent/40"
								>
									Show all {filtered.length} — {hiddenCount} more, pricier
								</button>
							) : null}

							{/* The pick isn't the cheapest — say why, or the seller
							    wonders why we chose the dearer one (test-code F19). */}
							{selected &&
							filtered[0] &&
							selected.serviceId ===
								defaultRateId(filtered, order.fulfilmentDate) &&
							selected.serviceId !== filtered[0].serviceId ? (
								<p className="text-xs text-muted-foreground">
									Picked <b className="text-foreground">{selected.label}</b>:
									the cheapest that{" "}
									{selected.deliversTo === "point"
										? "takes this parcel"
										: "reaches the buyer's door"}
									{buyerDate && rateDateFit(filtered[0], order.fulfilmentDate)
										? ` by ${buyerDate}`
										: filtered[0].minParcels !== undefined
											? " with a single parcel"
											: ""}
									. Cheaper ones are above — your call.
								</p>
							) : null}

							{/* A drop-off-only service is a different job for the
							    seller — said before they book it, not after. */}
							{selected && !selected.isPickup ? (
								<p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
									<b>{selected.courierName}</b> doesn&apos;t collect for this
									service — you drop the parcel at one of their points after
									booking.
								</p>
							) : null}

							{quotedBalance !== undefined ? (
								<p
									id={`easyparcel-wallet-${order.shortId}`}
									className={`flex items-center gap-1.5 text-xs ${
										selectedUnaffordable
											? `font-medium ${TONE_ACCENT.warn}`
											: "text-muted-foreground"
									}`}
								>
									<Wallet className="size-3.5 shrink-0" />
									{selectedUnaffordable ? (
										<>
											Wallet {formatPrice(quotedBalance, walletCurrency)} — not
											enough for this courier. Top up in EasyParcel, then
											refresh prices.
										</>
									) : (
										<>
											EasyParcel wallet:{" "}
											{formatPrice(quotedBalance, walletCurrency)}
										</>
									)}
								</p>
							) : null}

							{/* A refused booking is said where the seller just pressed —
							    a screen above it read as "nothing happened", and they
							    pressed again (test-code, z8r3fdr5yy). */}
							{error ? errorPanel : null}

							<Button
								type="button"
								className="h-11 w-full"
								isLoading={booking}
								disabled={booking || !selected || selectedUnaffordable}
								aria-describedby={
									selectedUnaffordable
										? `easyparcel-wallet-${order.shortId}`
										: undefined
								}
								onClick={() => void handleBook()}
							>
								{booking ? (
									"Booking…"
								) : (
									<>
										<Truck className="size-4" />
										Book {selected?.label} —{" "}
										{selected
											? formatPrice(
													selected.priceMinor,
													selected.currency || walletCurrency,
												)
											: ""}
									</>
								)}
							</Button>
							<p className="text-xs text-muted-foreground">
								{selected && !selected.isPickup
									? "Paid from your EasyParcel wallet when you book. Then drop the parcel at one of the courier's points — the tracking number and the courier's label land here."
									: "Paid from your EasyParcel wallet when you book, for collection today — EasyParcel arranges the pickup time with the courier. The tracking number and the courier's label land here."}
							</p>
							<button
								type="button"
								disabled={booking || quoting}
								className="flex min-h-11 items-center gap-1 self-start text-xs font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60"
								onClick={() => void handleQuote()}
							>
								<RefreshCw className="size-3" /> Refresh prices
							</button>
						</div>
					)}
				</>
			) : (
				<div className="flex flex-col gap-2">
					<Button type="button" className="h-11 w-full" disabled>
						<Truck className="size-4" /> Book a courier
					</Button>
					{/* The store-wide lock outranks this order's own block: it stops
					    every booking, and it is the one the seller can clear today. */}
					<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						{lockedReason ?? (
							<>
								{blockReason === "plan_gated" ? <ProBadge /> : null}
								{easyparcelBlockCopy(blockReason ?? "")}
								{blockReason === "reconnect_needed" ? (
									<Link
										to="/app/settings"
										search={{ tab: "integrations" }}
										className="font-medium text-accent hover:underline"
									>
										Reconnect EasyParcel
									</Link>
								) : blockReason === "no_sender_phone" ? (
									<Link
										to="/app/settings"
										search={{ tab: "whatsapp" }}
										className="font-medium text-accent hover:underline"
									>
										Add your WhatsApp number
									</Link>
								) : null}
							</>
						)}
					</p>
				</div>
			)}

			<ConfirmDialog
				open={confirmingCancel}
				onOpenChange={setConfirmingCancel}
				title="Cancel this courier booking?"
				description="We'll ask EasyParcel to cancel the shipment, and the charge goes back to your EasyParcel wallet. EasyParcel won't cancel once 7 days have passed since the collection date. The order itself doesn't change, and you can book again afterwards."
				confirmLabel="Cancel booking"
				cancelLabel="Keep booking"
				destructive
				onConfirm={async () => {
					const result = await cancelBooking({ shortId: order.shortId });
					if (result.ok)
						toast.success("Booking cancelled — refunded to your wallet");
					else toast.error(result.message ?? "Couldn't cancel the booking");
				}}
			/>
		</section>
	);
}

/** Two-letter mark for a courier — deliberate over EasyParcel's logo URLs,
 * which are theirs to move; the card renders the same offline. */
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "??";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

/** The one line under a service's name: the courier, and who moves the
 * parcel to it. */
function rateMeta(rate: EasyparcelRate): string {
	const how = rate.isPickup ? "Pickup from your door" : "You drop off";
	return [
		rate.courierName,
		how,
		...(rate.transit ? [transitLabel(rate.transit)] : []),
	].join(" · ");
}
